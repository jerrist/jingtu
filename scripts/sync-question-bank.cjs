const path = require("path");
const { spawnSync } = require("child_process");

const scripts = ["init-database.cjs", "import-question-bank.cjs", "export-question-bank.cjs", "validate-question-bank.cjs"];
for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
