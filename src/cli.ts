#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { init, query, path, godNodes, stats, benchmark, learn } from "./core.js";

const program = new Command();

program
  .name("engram")
  .description("AI coding memory that learns from every session")
  .version("0.1.0");

program
  .command("init")
  .description("Scan codebase and build knowledge graph (zero LLM cost)")
  .argument("[path]", "Project directory", ".")
  .action(async (projectPath: string) => {
    console.log(chalk.dim("🔍 Scanning codebase..."));
    const result = await init(projectPath);
    console.log(
      chalk.green("🌳 AST extraction complete") +
        chalk.dim(` (${result.timeMs}ms, 0 tokens used)`)
    );
    console.log(
      `   ${chalk.bold(String(result.nodes))} nodes, ${chalk.bold(String(result.edges))} edges from ${chalk.bold(String(result.fileCount))} files (${result.totalLines.toLocaleString()} lines)`
    );

    const bench = await benchmark(projectPath);
    if (bench.naiveFullCorpus > 0 && bench.reductionVsRelevant > 1) {
      console.log(
        chalk.cyan(`\n📊 Token savings: ${chalk.bold(bench.reductionVsRelevant + "x")} fewer tokens vs relevant files (${bench.reductionVsFull}x vs full corpus)`)
      );
      console.log(
        chalk.dim(`   Full corpus: ~${bench.naiveFullCorpus.toLocaleString()} tokens | Graph query: ~${bench.avgQueryTokens.toLocaleString()} tokens`)
      );
    }

    console.log(chalk.green("\n✅ Ready. Your AI now has persistent memory."));
    console.log(chalk.dim("   Graph stored in .engram/graph.db"));
  });

program
  .command("query")
  .description("Query the knowledge graph")
  .argument("<question>", "Natural language question or keywords")
  .option("--dfs", "Use DFS traversal", false)
  .option("-d, --depth <n>", "Traversal depth", "3")
  .option("-b, --budget <n>", "Token budget", "2000")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (question: string, opts: { dfs: boolean; depth: string; budget: string; project: string }) => {
    const result = await query(opts.project, question, {
      mode: opts.dfs ? "dfs" : "bfs",
      depth: Number(opts.depth),
      tokenBudget: Number(opts.budget),
    });
    if (result.nodesFound === 0) {
      console.log(chalk.yellow("No matching nodes found."));
      return;
    }
    console.log(chalk.dim(`Found ${result.nodesFound} nodes (~${result.estimatedTokens} tokens)\n`));
    console.log(result.text);
  });

program
  .command("path")
  .description("Find shortest path between two concepts")
  .argument("<source>", "Source concept")
  .argument("<target>", "Target concept")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (source: string, target: string, opts: { project: string }) => {
    const result = await path(opts.project, source, target);
    console.log(result.text);
  });

program
  .command("gods")
  .description("Show most connected entities (god nodes)")
  .option("-n, --top <n>", "Number of nodes", "10")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { top: string; project: string }) => {
    const gods = await godNodes(opts.project, Number(opts.top));
    if (gods.length === 0) {
      console.log(chalk.yellow("No nodes found. Run `engram init` first."));
      return;
    }
    console.log(chalk.bold("God nodes (most connected):\n"));
    for (let i = 0; i < gods.length; i++) {
      const g = gods[i];
      console.log(
        `  ${chalk.dim(String(i + 1) + ".")} ${chalk.bold(g.label)} ${chalk.dim(`[${g.kind}]`)} — ${g.degree} edges ${chalk.dim(g.sourceFile)}`
      );
    }
  });

program
  .command("stats")
  .description("Show knowledge graph statistics and token savings")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const s = await stats(opts.project);
    const bench = await benchmark(opts.project);

    console.log(chalk.bold("\n📊 engram stats\n"));
    console.log(`  Nodes:       ${chalk.bold(String(s.nodes))}`);
    console.log(`  Edges:       ${chalk.bold(String(s.edges))}`);
    console.log(
      `  Confidence:  ${chalk.green(s.extractedPct + "% EXTRACTED")} · ${chalk.yellow(s.inferredPct + "% INFERRED")} · ${chalk.red(s.ambiguousPct + "% AMBIGUOUS")}`
    );

    if (s.lastMined > 0) {
      const ago = Math.round((Date.now() - s.lastMined) / 60000);
      console.log(`  Last mined:  ${ago < 60 ? ago + "m ago" : Math.round(ago / 60) + "h ago"}`);
    }

    if (bench.naiveFullCorpus > 0) {
      console.log(`\n  ${chalk.cyan("Token savings:")}`);
      console.log(`    Full corpus:   ~${bench.naiveFullCorpus.toLocaleString()} tokens`);
      console.log(`    Avg query:     ~${bench.avgQueryTokens.toLocaleString()} tokens`);
      console.log(`    vs relevant:   ${chalk.bold.cyan(bench.reductionVsRelevant + "x")} fewer tokens`);
      console.log(`    vs full:       ${chalk.bold.cyan(bench.reductionVsFull + "x")} fewer tokens`);
    }
    console.log();
  });

program
  .command("learn")
  .description("Teach engram a decision, pattern, or lesson")
  .argument("<text>", "What to remember (e.g., 'We chose JWT over sessions for horizontal scaling')")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (text: string, opts: { project: string }) => {
    const result = await learn(opts.project, text);
    if (result.nodesAdded > 0) {
      console.log(chalk.green(`🧠 Learned ${result.nodesAdded} new insight(s).`));
    } else {
      console.log(chalk.yellow("No patterns extracted. Try a more specific statement."));
    }
  });

program
  .command("bench")
  .description("Run token reduction benchmark")
  .option("-p, --project <path>", "Project directory", ".")
  .action(async (opts: { project: string }) => {
    const result = await benchmark(opts.project);
    console.log(chalk.bold("\n⚡ engram token reduction benchmark\n"));
    console.log(`  Full corpus:     ~${result.naiveFullCorpus.toLocaleString()} tokens`);
    console.log(`  Avg graph query: ~${result.avgQueryTokens.toLocaleString()} tokens`);
    console.log(`  vs relevant:     ${chalk.bold.green(result.reductionVsRelevant + "x")} fewer tokens`);
    console.log(`  vs full corpus:  ${chalk.bold.green(result.reductionVsFull + "x")} fewer tokens\n`);
    for (const pq of result.perQuestion) {
      console.log(`  ${chalk.dim(`[${pq.reductionRelevant}x relevant / ${pq.reductionFull}x full]`)} ${pq.question}`);
    }
    console.log();
  });

program.parse();
