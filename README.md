# Naukri Profile Refresh

Keeps your Naukri profile "recently updated" — recruiters see fresh profiles first.
Every run it toggles a trailing `.` on your **resume headline** and automatically re-uploads your **resume document file** (PDF/DOCX), keeping your profile update timestamp fresh on Naukri. Schedule it hourly and forget about it.

- Logs in automatically with your **Google account** (session is saved after the first login).
- Runs in an off-screen Chrome window (Naukri blocks headless browsers).
- Verifies the save actually stuck on the server before reporting success.
- All personal data lives in `.env` — nothing sensitive is in the code.

## Requirements

- Windows 10/11 (uses Task Scheduler for the hourly run)
- [Node.js](https://nodejs.org/) 18+
- Google Chrome installed
- A Naukri account that signs in with Google

## Setup

**1. Clone and install:**

```powershell
git clone https://github.com/ankitbaghel01/naukri_update.git
cd naukri_update
npm install
```

**2. Create your `.env`:**

```powershell
copy .env.example .env
```

Open `.env` and fill in at least:

| Variable | What it is |
|---|---|
| `GOOGLE_EMAIL` | The Google account your Naukri profile uses |
| `GOOGLE_PASSWORD` | Its password (used only for the automated sign-in) |
| `NAUKRI_PROFILE_URL` | Your Naukri profile page — the default `https://www.naukri.com/mnjuser/profile` works for every account |
| `RESUME_PATH` | Path to your resume file (e.g. `resume.pdf`) to auto-upload on each run |

`.env` is git-ignored, so your credentials never get pushed.


**3. First login (one time, visible browser):**

```powershell
node naukri-profile-refresh.js login
```

A Chrome window opens and signs in with Google. If Google asks for 2-step
verification, approve it once — the session is saved to `.naukri-chrome-profile/`
and reused by every later run.

**4. Test a silent run:**

```powershell
node naukri-profile-refresh.js
```

Check `naukri-refresh.log` — you should see a line like:

```
[27/7/2026, 1:05:12 pm] OK: headline dot added (verified) → "AI Full Stack Developer | ..."
```

## Run it hourly (Task Scheduler)

Run this once in PowerShell (adjust the path to where you cloned the repo):

```powershell
$repo = "C:\path\to\auto-apply"
$action  = New-ScheduledTaskAction -Execute "node.exe" -Argument "`"$repo\naukri-profile-refresh.js`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "NaukriProfileRefresh" -Action $action -Trigger $trigger -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
```

That's it — the script now refreshes your profile every hour while your PC is on.

Useful commands:

```powershell
Get-ScheduledTask NaukriProfileRefresh            # check status
Start-ScheduledTask NaukriProfileRefresh          # run now
Disable-ScheduledTask NaukriProfileRefresh        # pause
Enable-ScheduledTask NaukriProfileRefresh         # resume
Unregister-ScheduledTask NaukriProfileRefresh     # remove
```

## Job Auto-Apply

Run the job auto-applier to automatically search and apply to relevant job postings matching your `.env` profile:

```powershell
npm run auto-apply
```

Or run in visible debug mode:

```powershell
node naukri-auto-apply.js visible
```

The auto-applier will:
- Search jobs based on `CURRENT_ROLE`, `SKILLS`, and `LOCATION` in `.env`.
- Skip external redirect sites and jobs you've already applied to.
- Auto-fill application popups/questionnaires (Notice period, CTC, Experience, links) from `.env`.
- Use `GEMINI_KEY` (if provided) to answer open-ended recruiter questions.
- Log results to `naukri-apply.log`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Google login did not complete` in the log | Run `node naukri-profile-refresh.js login` and approve the 2-step verification prompt once manually. |
| `save did not stick` in the log | Naukri changed its headline editor — open an issue. |
| Any other error | Check `naukri-refresh-error-*.png` screenshots in the repo folder — they show exactly what the browser saw when it failed. |
| Want to start fresh | Delete the `.naukri-chrome-profile/` folder and run the `login` step again. |

## Files

| File | Purpose |
|---|---|
| `naukri-profile-refresh.js` | Profile refresh script (headline + resume file upload) |
| `naukri-auto-apply.js` | Job search & auto-apply script |
| `config.js` | Loads `.env` configuration |
| `.env.example` | Template — copy to `.env` and fill in |
| `naukri-refresh.log` | Refresh run history (git-ignored) |
| `naukri-apply.log` | Job application history (git-ignored) |
| `.naukri-chrome-profile/` | Saved Chrome session (git-ignored) |

## Disclaimer

Automating your own profile or applications may be against Naukri's Terms of Service. It runs at a slow, human-like rate, but use at your own risk.

