// The first production deploy of the versioned model can't pause the old
// API remotely. Content writes (dashboard edits, agents publishing) must be
// paused by hand for the ~2 minutes between migration and API deploy.
if (process.env.CONFIRM_WRITE_FREEZE !== "1") {
  console.error([
    "Production deploy needs a content write freeze.",
    "Pause agents and dashboard edits on production, then rerun with CONFIRM_WRITE_FREEZE=1.",
  ].join("\n"));
  process.exit(1);
}
