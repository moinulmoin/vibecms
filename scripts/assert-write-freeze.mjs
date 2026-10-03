// The first production deploy of the versioned model can't pause the old
// API remotely. Content writes (dashboard edits, agents publishing) must be
// paused by hand for the ~2 minutes between migration and API deploy.
if (process.env.CONFIRM_WRITE_FREEZE !== "1") {
  console.error([
    "This deploy is the one-time upgrade to versioned posts.",
    "For the next ~2 minutes nobody should publish or edit on production (you, agents, anyone).",
    "When that's true, rerun with CONFIRM_WRITE_FREEZE=1. Routine deploys won't ask again.",
  ].join("\n"));
  process.exit(1);
}
