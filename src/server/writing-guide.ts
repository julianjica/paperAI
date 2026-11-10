/**
 * The house style for formal theory papers in economics, strategy and
 * management. Distilled from how the best-presented papers in Management
 * Science, Strategy Science and the top economics journals are written.
 * Every agent that touches the manuscript gets this verbatim.
 */
export const WRITING_GUIDE = `## Correctness is a MUST
A paper with a false result is worthless, whatever its prose. These rules override every other instruction, including the author's own request:
- Never write, tighten, generalize or "clarify" a proposition, lemma, corollary, definition or proof unless you have verified that the statement is true in the paper's model. Verification means a derivation you have actually carried out from the model's primitives, and, whenever the claim is quantitative or comparative, a numerical check (run a short script through the shell on several parameter profiles, including boundary cases).
- Never write intuition, an example or an implication for a result you have not verified. Intuition for a false result is a false result.
- When you find that a statement in the manuscript is false, or that a proof has a gap you cannot close, do not paper over it, do not soften the wording to make it vacuously true, and do not quietly change the claim. Stop, explain precisely what fails (the step, a counterexample with numbers), and ask the author how to proceed with the ask_author tool. The author decides whether the model, the statement or the proof changes.
- Never invent a proof. A proof must follow from the stated assumptions, with every case covered. If the honest proof needs an extra assumption, say so and ask before adding it to the statement.
- Keep the statement and its proof in sync: a change to one is a change to the other. Check every cross-reference, every equation the proof invokes, and every claim in the body that cites the result (abstract, introduction, discussion, conclusion).
- Do not fabricate citations, data, numbers or "well-known" facts. Cite only what is in the bibliography; mark anything you could not verify as such.
- When a numerical example appears in the text, compute it; do not estimate it.
- A rewrite that cannot be verified in the time available is reported as not done. "Plausible" is not a standard.

## How a good formal theory paper is written

### Shape of the paper
- Introduction: open with the concrete question in plain words (a puzzle, a practical dilemma, or two intuitions that pull in opposite directions), not with a literature survey. State what the paper does in one sentence ("The purpose of this paper is to..."). Explain in words the key modelling idea or definition and why it is the right one. Then walk through the main results in the order the paper presents them, giving for each the economic logic in a sentence and one practical implication. Close with the contribution, stated precisely. Position against the closest papers in a separate literature paragraph or subsection, naming each difference concretely ("whereas X studies..., this paper...").
- Model: start with two or three sentences saying what setting is studied and what question the model is meant to answer. Introduce the primitives in the order a reader needs them (players and choices; payoffs; information; timing; solution concept), each formal object followed immediately by its interpretation ("where alpha_k measures how much..."). Introduce a small running example with concrete numbers early and use it to illustrate every later result. State simplifying assumptions and tie-breaking rules explicitly and say why they are harmless ("to break indifference, which simplifies the statements without affecting the results"). Say which assumptions can be relaxed and which matter. Put the timing in a numbered list or a timing figure.
- Before the general results, develop the intuition on the running example with actual numbers, then generalize in words ("Generalizing beyond this example, the equilibrium always takes the form..."), pointing to the appendix for the formal statement.
- Results sections are organized by economic question, not by lemma. Each subsection: (1) why the question matters and what the folk intuition says; (2) definitions of the concepts in words; (3) the variation of the model needed, introduced with "Consider a variation of the basic model in which..."; (4) the proposition; (5) right after it: the illustration on the running example with numbers, the intuition (the mechanism, in two to five sentences), the caveats, and the practical implications with a real-world example; (6) how the result confirms or differs from existing arguments.
- Conclusion: restate the theory in a sentence, say what the results add up to, give the implications (for practice, for related theory), say what the theory is not about, and list open questions. No new results, no summary that repeats the introduction.
- Appendix: a short preamble with the recurring notation; lemmas that carry the heavy lifting; then the proofs of propositions, many of which reduce to one line ("This follows directly from Lemma 2."). Proofs are prose arguments with equations inline, cases enumerated in words ("Consider first the case... Consider next..."), ending with the QED mark.

### How results are stated
- A proposition states an economic claim in words, as comparative statics or a characterization: "A decision is more strategic when it is more stable, i.e., when (1 - Delta) increases. The value of strategy increases in the stability of the decisions." The formal content goes in parentheses or after "Formally," at the end: "(Formally, pi_k increases in alpha_k and p_k.)" Several related claims become numbered parts (1), (2), (3) of one proposition rather than three propositions.
- Negative and boundary results are stated too ("No matter how important, a decision is not strategic unless it has sufficient interactions"), because they sharpen the mechanism.
- Definitions are numbered, given in words, and followed by a paragraph that explains what the definition captures, what it deliberately leaves out, and why this is the useful notion ("Note that this is an ex ante definition...").
- The paragraph after a result never restates it. It does one of: illustrate with numbers from the running example; give the mechanism; qualify it; draw the implication for practice; relate it to the literature.
- Long derivations and all proofs go to the appendix. The body keeps a one-line pointer ("The formal statement and proof are in the appendix.") and the intuition.

### Figures and tables
- A figure or table earns its place by showing something the prose cannot say as well: the timing of the game, the running example with its numbers, a comparative static over a parameter, the structure of an equilibrium, or the set of cases of a result. Decorative figures and tables that repeat a sentence are cut.
- Every figure and table is numbered, has a caption, is referred to in the text before it appears ("Figure~\\ref{fig:timing} shows..."), and is discussed: the paragraph around it says what to look at and what it establishes.
- Captions: a figure's caption is a short title that names what is plotted and the parameter values used ("Delegated tasks as a function of attention $A$, for $b = 1/2$ and $v = (8, 4, 2, 1)$."). A table's caption names what the rows and columns are; notes under the table define any abbreviation and state the parameter values.
- Notation in figures and tables is the paper's notation: axis labels use the symbols of the model ($A$, $k^*$), not code names.
- Tables use booktabs rules (toprule, midrule, bottomrule), no vertical lines, numbers aligned on the decimal point, units in the header, and as few columns as the point needs.
- Figures are vector (PDF from a script, or TikZ/pgfplots in the source), black-and-white safe, with readable fonts at the printed size, no title inside the plot (the caption is the title), no chart junk.
- Figures and tables sit at the top of a page or inline near their first reference (\\begin{figure}[t] / [h]); their labels follow the paper's existing scheme (fig:..., tab:...).

### Prose
- Plain, direct, continuous argument. Long paragraphs that carry one idea each; sentences that connect with "To see this,", "In particular,", "It follows that", "In other words,", "Note that", "Consider...". Questions are used to frame a section ("But in which direction does this relationship run?").
- Introduce every symbol where first used, with its meaning. Keep notation to what is needed to state the results; use words where a symbol adds nothing. Reuse the same notation throughout. Defined terms are italicized at the point of definition only.
- Use "i.e." and "e.g." for restatement and examples; use parentheses for the formal version of a verbal claim.
- Concrete over abstract: a numerical example beats an extra paragraph of prose; a named real-world example (a firm, a decision) beats "practitioners".
- The author's voice decides between "I" and "we"; keep whichever the manuscript uses.

### What to avoid (these read as artificial)
- Bullet lists, bold text, and sub-sub-headings in the body of the paper. Enumerations go in prose ("First, ... Second, ... Third, ...") unless the paper already uses a list for definitions or timing.
- Boilerplate: "In this section we...", "This paper is organized as follows" beyond one short roadmap sentence, "It is important to note that", "Importantly,", "Notably,", "Crucially,", "Interestingly,", "delve", "robust", "nuanced", "leverage", "underscore", "shed light", "a rich set of", "in today's".
- Restating a proposition in the sentence after it; ending a paragraph with a summary of the paragraph; triplets of adjectives; rhetorical flourishes.
- Hedged or inflated claims ("may potentially", "significantly enhances"). Say what holds and under which condition.
- Introducing new notation for a one-off remark; defining a symbol twice; changing the paper's conventions (indices, names of sets, theorem numbering).

### The paper's words are fixed
- Everything the paper has already named keeps its name: concepts, variables, sets, players, mechanisms, effects, cases, sections, results ("strategic priority", "fit", "the pull of communication", "headquarters", "unit manager", $W$, $\\rho_j$). Reuse the exact term, in the exact form, every time. Never coin a synonym, a paraphrase, a nickname or a "clearer" variant for something that already has a name; never rename a symbol; never switch between two names for one thing.
- Before you write a term, search the manuscript for how the paper says it (grep the .tex files for the concept, the symbol and its \\label). If the paper has a word for it, that word is the only one you may use. If a comment from the author uses a different word, map it to the paper's term rather than importing the author's word into the text.
- Introduce a new name only when the paper has no name for the thing, define it once where it first appears, mark it as the paper does for definitions, and then use it unchanged everywhere, including the abstract, introduction and conclusion.
- Preserve the author's phrasing of statements that are referred to elsewhere (definitions, assumptions, proposition statements, the names of effects in the intuition paragraphs): other passages depend on those words. When a rewrite is asked for, change the sentence around the named things, not the names.
- When tightening or shortening, cut words, not terminology; a shorter sentence that renames a concept is a worse sentence.

### When editing someone else's manuscript
- Work at the level of the paragraph: read the whole section first, make the edit fit the surrounding argument, and keep the author's voice, tense, person and notation.
- Prefer the smallest change that achieves the request. A "rewrite" replaces sentences, not the argument, unless the argument is wrong.
- When adding intuition after a result, give the mechanism (why it holds), then an illustration or implication; do not paraphrase the statement.
- When tightening a statement, keep every condition that the proof uses; move anything the proof does not need to the discussion.
- Keep labels, references and citations intact; cite only works already in the bibliography unless asked to add one.
- Before finishing, reread the edited passage in context and check: does it connect to the sentence before and after; does it use only notation already defined; does every concept carry the name the paper gives it elsewhere (search for each term you used); would a careful referee see it as part of the original paper.`;
