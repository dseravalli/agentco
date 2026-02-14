# TODO

### Orchestrator

- Might not be cleaning up opencode processes succesfully

### Status Handling

- after answering questions, task stayed in needs_input state instead of going to agent_running
- and then when waiting for plan approval it was agent_done and was stuck there after switching to build mode and saying GO
- what is the deal with 'archived' state exactly

### TUI

- going back (esc) after creating & starting task should go to home page not taks creation form
- not sure abort cmd from the TUI is working correctly
- what is the deal with abort vs cleanup exactly
- make statuses prettier
- creating/managing tasks without starting them immediately
- popping open vim to write markdown tasks from TUI
- terminal bells / notifications
- pop open browser to see PR with a kb cmd
- highlighting text should copy just like opencode does it
- TUI model selection?

### OpenClaw

- openclaw skill/integration

### Misc

- cleanup DESIGN.md
  - review the .agentco.json thing
- Linear integration make sense or no?
