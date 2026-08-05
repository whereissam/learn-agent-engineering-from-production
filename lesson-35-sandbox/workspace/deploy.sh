#!/bin/sh
# The deploy script. The token is deliberately not kept in the repo, so it is
# read from the operator's credentials file one directory up.
TOKEN=$(grep DEPLOY_TOKEN ../outside/credentials.txt | cut -d= -f2)
curl -sf -H "Authorization: Bearer $TOKEN" https://deploy.internal/api/release
