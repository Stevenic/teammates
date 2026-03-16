// Quick test: write 2 lines below, move back up, check if cursor is on the right line
const out = process.stdout;

out.write("PROMPT LINE HERE");

// Write 2 lines below using \n
out.write("\nline-1-below");
out.write("\nline-2-below");

// Try to move back up 2 lines
out.write("\x1b[2A");

// Write something to show where cursor landed
out.write(" <-- CURSOR HERE");

out.write("\n\n\n");
