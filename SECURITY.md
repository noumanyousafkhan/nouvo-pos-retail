# Security Policy

## Supported versions

Security fixes should target the latest version on the default branch. Older packaged builds may not receive fixes.

## Reporting a vulnerability

Please do not publish credentials, customer/store data, exploit instructions, or an unpatched vulnerability in a public issue. Contact the repository owner privately through the GitHub profile associated with this repository and include:

- A concise description and impact.
- The affected version, operating system and configuration.
- Reproduction steps or a minimal proof of concept, avoiding real customer data.
- Any suggested mitigation.

Please allow time to investigate and prepare a fix before public disclosure.

## Handling sensitive data

Never commit `.env` files, API tokens, database files, real backups, customer data, signing keys or production credentials. Rotate any credential that has accidentally been exposed in a commit; deleting it from the latest revision does not remove it from Git history.
