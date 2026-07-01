import os
import re
import csv
import uuid
import asyncio
from typing import Dict, List, Optional
from pathlib import Path
from pydantic import BaseModel
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Adjust paths to import our flow code
import sys
src_dir = str(Path(__file__).parent.parent)
if src_dir not in sys.path:
    sys.path.append(src_dir)

from lead_score_flow.main import LeadScoreFlow, LeadScoreState
from lead_score_flow.utils.candidateUtils import combine_candidates_with_scores

app = FastAPI(title="CrewAI Lead Score Flow Web API")

# Enable CORS for frontend development server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all for simplicity, frontend runs on 5173
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared memory state for active runs
class ActiveRun:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.status = "idle"  # idle, running, waiting_for_human, generating_emails, completed, failed, quit
        self.candidates: List[dict] = []
        self.scored_candidates: List[dict] = []
        self.top_candidates: List[dict] = []
        self.emails: Dict[str, str] = {}
        self.feedback = ""
        self.choice: Optional[str] = None
        self.choice_event = asyncio.Event()
        self.error: Optional[str] = None
        self.logs: List[str] = []

    def add_log(self, message: str):
        self.logs.append(message)
        print(f"[{self.run_id}] {message}")

    def to_dict(self):
        return {
            "run_id": self.run_id,
            "status": self.status,
            "candidates": self.candidates,
            "scored_candidates": self.scored_candidates,
            "top_candidates": self.top_candidates,
            "emails": self.emails,
            "feedback": self.feedback,
            "choice": self.choice,
            "error": self.error,
            "logs": self.logs,
        }

active_runs: Dict[str, ActiveRun] = {}

class ChoiceRequest(BaseModel):
    choice: str
    feedback: str

class SettingsRequest(BaseModel):
    openai_api_key: str
    serper_api_key: Optional[str] = ""

# WebLeadScoreFlow extends the original LeadScoreFlow to use web hooks instead of terminal prompts
class WebLeadScoreFlow(LeadScoreFlow):
    def __init__(self, run_id: str, active_run: ActiveRun, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.run_id = run_id
        self.active_run = active_run

    def load_leads(self):
        self.active_run.add_log("Loading leads from CSV...")
        super().load_leads()
        self.active_run.candidates = [c.model_dump() for c in self.state.candidates]
        self.active_run.add_log(f"Successfully loaded {len(self.active_run.candidates)} candidates.")

    async def score_leads(self):
        self.active_run.status = "running"
        self.active_run.add_log("Starting LeadScoreCrew evaluation for all candidates...")
        # Since score_leads in parent class is async, we await it
        await super().score_leads()
        self.active_run.add_log("Finished evaluation and scoring for all candidates.")

    async def human_in_the_loop(self):
        self.active_run.add_log("Combining candidate details with AI scores...")
        self.state.hydrated_candidates = combine_candidates_with_scores(
            self.state.candidates, self.state.candidate_score
        )

        sorted_candidates = sorted(
            self.state.hydrated_candidates, key=lambda c: c.score, reverse=True
        )
        self.state.hydrated_candidates = sorted_candidates
        top_candidates = sorted_candidates[:3]

        self.active_run.scored_candidates = [c.model_dump() for c in self.state.hydrated_candidates]
        self.active_run.top_candidates = [c.model_dump() for c in top_candidates]
        self.active_run.status = "waiting_for_human"
        self.active_run.add_log("Flow paused: awaiting human evaluation review...")

        # Wait for user input from the REST API endpoint
        self.active_run.choice_event.clear()
        await self.active_run.choice_event.wait()

        choice = self.active_run.choice
        feedback = self.active_run.feedback

        self.active_run.add_log(f"User input received. Choice: {choice}, Feedback: '{feedback}'")

        if choice == "1":
            self.active_run.status = "quit"
            self.active_run.add_log("Flow exited by user choice.")
            raise Exception("Workflow quit by user.")
        elif choice == "2":
            self.active_run.status = "running"
            self.active_run.feedback = feedback
            self.state.scored_leads_feedback = feedback
            self.active_run.add_log(f"Rerunning evaluation with feedback: '{feedback}'")
            # Clear previous scores so they get regenerated
            self.state.candidate_score = []
            return "scored_leads_feedback"
        elif choice == "3":
            self.active_run.status = "generating_emails"
            self.active_run.add_log("Approval received. Proceeding to email generation...")
            return "generate_emails"
        else:
            self.active_run.add_log("Invalid choice received. Defaulting back to review.")
            return "human_in_the_loop"

    async def write_and_save_emails(self):
        self.active_run.add_log("Starting LeadResponseCrew email generation...")
        await super().write_and_save_emails()
        self.active_run.add_log("Completed email generation for top candidates.")

        # Read the generated emails
        output_dir = Path(__file__).parent / "email_responses"
        emails = {}
        for candidate in self.state.hydrated_candidates:
            safe_name = re.sub(r"[^a-zA-Z0-9_\- ]", "", candidate.name)
            filename = f"{safe_name}.txt"
            file_path = output_dir / filename
            if file_path.exists():
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        emails[candidate.name] = f.read()
                except Exception as e:
                    self.active_run.add_log(f"Failed to read email file for {candidate.name}: {e}")
        
        self.active_run.emails = emails
        self.active_run.status = "completed"
        self.active_run.add_log("Campaign flow completed successfully!")


# Run execution helper
async def run_flow_background(run_id: str):
    active_run = active_runs[run_id]
    try:
        flow = WebLeadScoreFlow(run_id=run_id, active_run=active_run)
        await flow.kickoff_async()
    except Exception as e:
        import traceback
        error_msg = str(e)
        active_run.error = error_msg
        active_run.status = "failed"
        active_run.add_log(f"Flow execution failed with error: {error_msg}")
        active_run.add_log(traceback.format_exc())


@app.post("/api/runs")
async def start_campaign(background_tasks: BackgroundTasks):
    # Verify API key is set
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=400,
            detail="OpenAI API Key is not set. Please set it in the Settings panel."
        )

    run_id = str(uuid.uuid4())
    active_run = ActiveRun(run_id)
    active_run.status = "running"
    active_run.add_log("Initializing Lead Score Campaign...")
    active_runs[run_id] = active_run

    background_tasks.add_task(run_flow_background, run_id)
    return {"run_id": run_id, "status": active_run.status}


@app.get("/api/runs")
async def list_campaigns():
    return [run.to_dict() for run in active_runs.values()]


@app.get("/api/runs/{run_id}")
async def get_campaign(run_id: str):
    if run_id not in active_runs:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return active_runs[run_id].to_dict()


@app.post("/api/runs/{run_id}/choice")
async def submit_choice(run_id: str, payload: ChoiceRequest):
    if run_id not in active_runs:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    active_run = active_runs[run_id]
    if active_run.status != "waiting_for_human":
        raise HTTPException(status_code=400, detail="Campaign is not waiting for human input")
    
    active_run.choice = payload.choice
    active_run.feedback = payload.feedback
    active_run.choice_event.set()
    return {"status": "resuming"}


@app.get("/api/leads")
async def get_initial_leads():
    # Read leads from leads.csv
    csv_file = Path(__file__).parent / "leads.csv"
    leads = []
    if csv_file.exists():
        try:
            with open(csv_file, mode="r", newline="", encoding="utf-8") as file:
                reader = csv.DictReader(file)
                for row in reader:
                    leads.append(row)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to read leads.csv: {e}")
    return leads


@app.post("/api/settings")
async def save_settings(settings: SettingsRequest):
    if not settings.openai_api_key:
        raise HTTPException(status_code=400, detail="OpenAI API Key cannot be empty")
    
    os.environ["OPENAI_API_KEY"] = settings.openai_api_key
    if settings.serper_api_key:
        os.environ["SERPER_API_KEY"] = settings.serper_api_key
    else:
        if "SERPER_API_KEY" in os.environ:
            del os.environ["SERPER_API_KEY"]
            
    return {"message": "Settings updated successfully"}


@app.get("/api/settings")
async def get_settings():
    return {
        "openai_api_key_set": bool(os.environ.get("OPENAI_API_KEY")),
        "serper_api_key_set": bool(os.environ.get("SERPER_API_KEY")),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("web_backend:app", host="127.0.0.1", port=8000, reload=True)
