#!/usr/bin/env bash
# Crea el repositorio en tu GitHub y sube el código.
# Requisitos: git y GitHub CLI (gh) con sesión iniciada: gh auth login
set -euo pipefail

REPO_NAME="${1:-cumplia}"
VISIBILITY="${2:-private}"   # private | public

command -v gh >/dev/null || { echo "Falta GitHub CLI: https://cli.github.com"; exit 1; }
gh auth status >/dev/null || { echo "Ejecutá primero: gh auth login"; exit 1; }

OWNER="$(gh api user --jq .login)"
sed -i.bak "s/@TU_USUARIO/@${OWNER}/" .github/CODEOWNERS && rm -f .github/CODEOWNERS.bak
git add -A && git commit -m "chore: configura CODEOWNERS" || true

gh repo create "${REPO_NAME}" "--${VISIBILITY}" --source=. --remote=origin --push

# Protección de la rama main (en repos privados requiere plan que lo soporte)
gh api -X PUT "repos/${OWNER}/${REPO_NAME}/branches/main/protection" --input - <<JSON || echo "Aviso: no se pudo activar la protección de rama (revisá tu plan de GitHub)."
{
  "required_status_checks": { "strict": true, "contexts": ["verify"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
JSON

echo "Listo: https://github.com/${OWNER}/${REPO_NAME}"
