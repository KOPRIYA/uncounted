import { runEvaluation } from '../dist/evaluation.js';

const report = await runEvaluation();
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
