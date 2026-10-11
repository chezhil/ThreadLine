# Security policy

## Reporting a vulnerability

Please don't open a public issue. Contact the maintainers privately through GitHub with a
description, steps to reproduce and the impact. We aim to acknowledge reports within 72 hours.

## Security model

- Every API route and page checks the user's role on the server.
- Passwords are bcrypt-hashed; session tokens are 256-bit random values stored only as SHA-256
  hashes, in HTTP-only `SameSite=Lax` cookies (`Secure` in production).
- Password changes require the current password, are rate-limited, revoke other sessions and are audited.
- Socket.IO connections require a valid session.
- Input is validated with Zod; queries are parameterised by Prisma. The AI assistant can only run
  fixed read-only queries and never generates SQL.
- The WhatsApp webhook rejects requests without a valid `X-Hub-Signature-256`.
- Secrets come from environment variables only and never reach the browser.

Change the seeded demo passwords before exposing any instance.
