#!/usr/bin/env node
import { Command } from "commander";
import { registerProjectCommands } from "./commands/project.js";
import { registerTaskCommands } from "./commands/task.js";

const program = new Command();

program
  .name("agentco")
  .description("CLI for the AgentCo multi-agent orchestration system")
  .version("0.1.0");

registerProjectCommands(program);
registerTaskCommands(program);

program.parse();
