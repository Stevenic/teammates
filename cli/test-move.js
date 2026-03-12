const rl = require('readline');
const out = process.stdout;

out.write("PROMPT LINE");
out.write("\nline-1");
out.write("\nline-2");

// Use readline's moveCursor to go up 2
rl.moveCursor(out, 0, -2);
out.write(" <CURSOR>");

out.write("\n\n\n");
