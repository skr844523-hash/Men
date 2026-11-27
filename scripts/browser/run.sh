cd /downloads/meenwork
export ADMIN_EMAIL=ssakr9640@gmail.com FIREBASE_PROJECT_ID=men2-87abd VITE_FIREBASE_EMULATOR=1 PORT=3137
timeout 110 npx firebase emulators:exec --only auth,database --project men2-87abd "bash -c 'node --import tsx server/dev.ts > /tmp/dev.log 2>&1 & DP=\$!; for i in \$(seq 1 40); do curl -s localhost:3137/api/health >/dev/null && break; sleep 1; done; cd /tmp/pw && node $1; E=\$?; kill \$DP; exit \$E'"
