# Security

SEEKER runs shell commands and edits files on the machine it is started on, and its remote
control carries those abilities over the network. Reports about the following are especially welcome:

- a way past the permission prompt (`src/permissions.mjs`, `src/external-tools.mjs`)
- anything the relay could read, forge or replay (`src/remote.mjs`, `remote-server/server.mjs`)
- Web Push encryption or the push host allowlist (`src/webpush.mjs`)
- text from a file, web page or tool result that makes the agent act without the user's approval

## Reporting

Please do not open a public issue. Use **Security → Report a vulnerability** on the GitHub
repository (private vulnerability reporting). Include the steps to reproduce and the version or commit.

## What is not a vulnerability

- `--yolo` skipping prompts: that is what the flag is for. Commands matching the dangerous
  patterns are still asked about; a way to avoid *that* is a vulnerability.
- A model giving a wrong or made-up answer.
