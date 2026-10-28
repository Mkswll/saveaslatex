import assert from "node:assert/strict";
import test from "node:test";
import { buildUserPrompt, composeSystemPrompt } from "../src/agent.js";
import {
  assembleTex,
  fileNameFor,
  formatPartLabels,
  guessMeta,
  parseAgentJson,
  sanitizeStatement,
  splitDraftQuestions,
} from "../src/template.js";

test("homework file matches the template", () => {
  const tex = assembleTex({
    course: "MATHXXX",
    assignment: "X",
    author: "Maxwell He",
    headerPath: "/Users/maxwellhe/Desktop/Everything/LatexHeader",
    questions: [
      { number: 1, statement: "Compute $1+1$." },
      { number: 2, statement: "Let $n \\in \\N$." },
    ],
  });

  assert.equal(
    tex,
    `\\documentclass{article}
\\usepackage[margin = 0.75in, headheight = 0.75in]{geometry}

\\input{/Users/maxwellhe/Desktop/Everything/LatexHeader}

\\title{MATHXXX Assignment X}
\\author{Maxwell He}
% \\date{}

\\pagestyle{fancy}
% \\fancyhf{}
\\fancyhead[R]{MATHXXX Assignment X}

\\begin{document}

\\maketitle

\\section*{Question 1}
\\markright{Question 1}

Compute $1+1$.

\\newpage
\\section*{Question 2}
\\markright{Question 2}

Let $n \\in \\N$.

\\end{document}
`,
  );
});

test("same-line question text is kept and file names drop spaces", () => {
  const questions = splitDraftQuestions("Question 1. Compute $1+1$.\n\nProblem 2: Show it.");
  assert.equal(questions.length, 2);
  assert.equal(questions[0].number, "1");
  assert.match(questions[0].statement, /^Compute \$1\+1\$\./);
  assert.match(questions[1].statement, /^Show it\./);
  assert.equal(fileNameFor("MATH 240", "3"), "MATH240_Assignment_3.tex");
});

test("agent JSON and course guesses", () => {
  const plan = parseAgentJson(
    '```json\n{"course":"MATH 135","assignment":"2","questions":[{"number":1,"statement":"Hi"}]}\n```',
  );
  assert.equal(plan.course, "MATH 135");
  assert.equal(plan.questions[0].statement, "Hi");
  assert.equal(guessMeta("Homework 4 for Math 240", "Assignment").course, "MATH 240");
  assert.equal(guessMeta("Homework 4 for Math 240", "").assignment, "4");
});

test("enumerate and itemize put one item on each line", () => {
  const formatted = formatPartLabels(
    "\\begin{enumerate}[label=(\\alph*)]\\item[a] One \\item (b) Two\\end{enumerate}\nSee\n\\begin{itemize}\\item red \\item blue\\end{itemize}",
  );
  assert.equal(
    formatted,
    `\\begin{enumerate}
\\item[(a)] One
\\item[(b)] Two
\\end{enumerate}

See
\\begin{itemize}
\\item red
\\item blue
\\end{itemize}`,
  );

  const nested = formatPartLabels(
    "\\begin{enumerate}\\item[a] See \\begin{itemize}\\item one \\item two\\end{itemize} \\item[b] Done\\end{enumerate}",
  );
  assert.equal(
    nested,
    `\\begin{enumerate}
\\item[(a)] See
\\begin{itemize}
\\item one
\\item two
\\end{itemize}
\\item[(b)] Done
\\end{enumerate}`,
  );
});

test("custom instructions are added to the system prompt", () => {
  const prompt = composeSystemPrompt("Use \\mathbb for fields.", "Problem 3 is a bonus.");
  assert.match(prompt, /Standing instructions:\nUse \\mathbb for fields\./);
  assert.match(prompt, /Instructions for this assignment:\nProblem 3 is a bonus\./);
  assert.match(prompt, /Follow the standing instructions/);
  assert.equal(composeSystemPrompt("", "  "), composeSystemPrompt());
});

test("standing instructions stay in the prompt and lists are still formatted", () => {
  const prompt = buildUserPrompt({
    text: "Question 1",
    extraPrompt: "Use \\mathbb for fields.",
    assignmentPrompt: "Problem 3 is a bonus.",
    headerPath: "/Users/maxwellhe/Desktop/Everything/LatexHeader",
  });
  assert.match(prompt, /Lettered parts still use \\item\[\(a\)\]/);
  assert.match(prompt, /Standing instructions:\nUse \\mathbb for fields\./);
  assert.match(prompt, /Instructions for this assignment:\nProblem 3 is a bonus\./);

  const tex = assembleTex({
    course: "MATH 240",
    assignment: "3",
    questions: [{ number: 1, statement: "(a) One.\n(b) Two." }],
  });
  assert.match(tex, /\\item\[\(a\)\] One\./);
  assert.match(tex, /\\item\[\(b\)\] Two\./);
  assert.match(tex, /\\begin\{enumerate\}/);
});

test("lettered parts use enumerate with parentheses in the label", () => {
  const formatted = formatPartLabels(
    "Do each part.\n(a) Compute $1+1$.\n(b) Compute $2+2$.\n(c) Compute $3+3$.\n(d) Stop.",
  );
  assert.equal(
    formatted,
    `Do each part.
\\begin{enumerate}
\\item[(a)] Compute $1+1$.
\\item[(b)] Compute $2+2$.
\\item[(c)] Compute $3+3$.
\\item[(d)] Stop.
\\end{enumerate}`,
  );

  const alreadyLabeled = formatPartLabels("\\begin{enumerate}\n\\item (a) One\n\\item[(b)] Two\n\\end{enumerate}");
  assert.match(alreadyLabeled, /\\item\[\(a\)\] One/);
  assert.match(alreadyLabeled, /\\item\[\(b\)\] Two/);
  assert.equal(formatPartLabels("Let $f(a)$ and $f(b)$ be given."), "Let $f(a)$ and $f(b)$ be given.");
  assert.equal(formatPartLabels("(a) Only one part."), "(a) Only one part.");
});

test("page content cannot inject file or shell commands", () => {
  const clean = sanitizeStatement(
    "See \\input{/etc/passwd} and \\write18{rm -rf ~} and \\begin{align} x \\end{align}",
  );
  assert.doesNotMatch(clean, /\\input\b/);
  assert.doesNotMatch(clean, /\\write18\b/);
  assert.match(clean, /\\begin\{align\}/);
});

test("prompt includes the page and the hints", () => {
  const prompt = buildUserPrompt({
    title: "HW",
    href: "https://example.edu/hw",
    h1: "Assignment 3",
    text: "Question 1\nIntegrate.",
    course: "MATH 240",
    assignment: "3",
    truncated: false,
    hasImage: false,
    headerPath: "/Users/maxwellhe/Desktop/Everything/LatexHeader",
    headerName: "LatexHeader",
    headerText: "\\newcommand{\\N}{\\mathbb{N}}",
    headerTruncated: false,
  });
  assert.match(prompt, /MATH 240/);
  assert.match(prompt, /Integrate\./);
  assert.match(prompt, /https:\/\/example\.edu\/hw/);
  assert.match(prompt, /Header path: \/Users\/maxwellhe\/Desktop\/Everything\/LatexHeader/);
  assert.match(prompt, /Opened header file: LatexHeader/);
  assert.match(prompt, /\\newcommand\{\\N\}\{\\mathbb\{N\}\}/);
});

test("broken latex escapes stay commands and later questions are split out", () => {
  const raw = String.raw`{"course":"CO 342","assignment":"5","questions":[{"number":1,"statement":"\textit{Subdivisions.}\n\begin{enumerate}\n\textit{(a)} Prove.\n\textit{(b)} Deduce.\ndrop your answer here, or click browse\n\textit{Supports: PDF, JPG, and PNG formats}\n\textit{Q2}\nLet $G$ be planar.\n\textit{Q3}\nLet $P$ satisfy $\big\{a_0\big\}$ and $\text{mod}$ and $\leq$."}]}`;
  const plan = parseAgentJson(raw);
  assert.equal(plan.course, "CO 342");
  assert.equal(plan.questions.length, 3);
  assert.equal(String(plan.questions[1].number), "2");
  assert.equal(String(plan.questions[2].number), "3");
  assert.match(plan.questions[0].statement, /\\textit\{Subdivisions\.\}/);
  assert.match(plan.questions[0].statement, /\\begin\{enumerate\}/);
  assert.match(plan.questions[1].statement, /Let \$G\$ be planar\./);
  assert.doesNotMatch(plan.questions.map((question) => question.statement).join("\n"), /drop your answer/i);
  assert.doesNotMatch(plan.questions.map((question) => question.statement).join("\n"), /Supports:/i);

  const tex = assembleTex({
    course: plan.course,
    assignment: plan.assignment,
    questions: plan.questions,
  });
  assert.match(tex, /\\section\*\{Question 1\}/);
  assert.match(tex, /\\section\*\{Question 2\}/);
  assert.match(tex, /\\section\*\{Question 3\}/);
  assert.match(tex, /\\item\[\(a\)\] Prove\./);
  assert.match(tex, /\\item\[\(b\)\] Deduce\./);
  assert.match(tex, /\\big\\\{a_0\\big\\\}/);
  assert.match(tex, /\\text\{mod\}/);
  assert.match(tex, /\\leq/);
  assert.match(tex, /\\textit\{Subdivisions\.\}/);
  assert.match(tex, /\\begin\{enumerate\}/);
});
