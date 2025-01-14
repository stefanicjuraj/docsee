import { parse } from "https://deno.land/std@0.203.0/flags/mod.ts";
import { load } from "https://deno.land/std@0.203.0/dotenv/mod.ts";

interface GitHub {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  url: string;
}

interface Analysis {
  folderCount: number;
  fileCount: number;
  wordCount: number;
  totalSize: number;
}

async function fetchRepository(
  token: string,
  owner: string,
  repo: string,
  path = "",
): Promise<GitHub[]> {
  const apiURL =
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const response = await fetch(apiURL, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!response.ok) {
    throw new Error(`⛔ Failed to fetch ${apiURL}: ${response.statusText}`);
  }
  return response.json();
}

async function traverseRepository(
  token: string,
  owner: string,
  repo: string,
  path = "",
): Promise<Record<string, unknown>> {
  const items = await fetchRepository(token, owner, repo, path);
  const result: Record<string, unknown> = {};

  for (const item of items) {
    if (item.type === "dir") {
      result[item.name] = await traverseRepository(
        token,
        owner,
        repo,
        item.path,
      );
    } else if (item.type === "file") {
      if (item.name.endsWith(".md") || item.name.endsWith(".mdx")) {
        result[item.name] = item.download_url;
      }
    }
  }
  return result;
}

function renderHTML(tree: Record<string, unknown>): string {
  let html = "<ul class='tree'>";
  for (const key in tree) {
    if (typeof tree[key] === "string") {
      html += `<li class="file"><span class="icon">📄</span><a href="${
        tree[key]
      }" target="_blank">${key}</a></li>`;
    } else {
      html += `<li class="folder"><span class="icon">📁</span>${key}${
        renderHTML(tree[key] as Record<string, unknown>)
      }</li>`;
    }
  }
  html += "</ul>";
  return html;
}

async function analyzeRepository(
  tree: Record<string, unknown>,
): Promise<Analysis> {
  let stats: Analysis = {
    folderCount: 0,
    fileCount: 0,
    wordCount: 0,
    totalSize: 0,
  };

  for (const key in tree) {
    const value = tree[key];
    if (typeof value === "string") {
      stats.fileCount++;
      try {
        const response = await fetch(value);
        if (response.ok) {
          const content = await response.text();
          stats.totalSize += content.length;
          const words = content.trim().split(/\s+/);
          stats.wordCount += words[0] === "" ? 0 : words.length;
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(`⛔ Error fetching file ${key}: ${error.message}`);
        } else {
          console.error(`⛔ Error fetching file ${key}: ${String(error)}`);
        }
      }
    } else if (typeof value === "object") {
      stats.folderCount++;
      const subStats = await analyzeRepository(
        value as Record<string, unknown>,
      );
      stats.folderCount += subStats.folderCount;
      stats.fileCount += subStats.fileCount;
      stats.wordCount += subStats.wordCount;
      stats.totalSize += subStats.totalSize;
    }
  }

  return stats;
}

async function loadTemplate(
  templatePath: string,
  content: string,
  analysis: string,
): Promise<string> {
  const template = await Deno.readTextFile(templatePath);
  return template.replace("{{content}}", content)
    .replace("{{analysis}}", analysis);
}

function renderRepositoryAnalysis(stats: Analysis): string {
  const avgSize = stats.fileCount > 0
    ? (stats.totalSize / stats.fileCount) / 1024
    : 0;
  return `
    <div class="analysis">
    📁 Folder count:        <span class="green">${stats.folderCount}</span>
    📄 File count:          <span class="green">${stats.fileCount}</span>
    💬 Word count:          <span class="green">${stats.wordCount}</span>
    📏 Average file size:   <span class="green">${avgSize.toFixed(2)} KB</span>
    </div>
`;
}

async function main() {
  const args = parse(Deno.args);
  if (!args.github) {
    console.error("Usage: docsee --github owner/repository");
    Deno.exit(1);
  }

  const env = await load({ export: true });
  const token = env.GITHUB_TOKEN || Deno.env.get("GITHUB_TOKEN");
  if (!token) {
    console.error("⚠️ GITHUB_TOKEN not set in environment or .env file.");
    Deno.exit(1);
  }

  const repoInfo = String(args.github).split("/");
  if (repoInfo.length !== 2) {
    console.error("⚠️ Repository should be specified as owner/repository.");
    Deno.exit(1);
  }
  const [owner, repo] = repoInfo;

  console.log(`⚙️ Fetching repository: ${owner}/${repo}`);
  const tree = await traverseRepository(token, owner, repo);
  const stats = await analyzeRepository(tree);
  const analysisHTML = renderRepositoryAnalysis(stats);
  const htmlContent = renderHTML(tree);
  const htmlDocument = await loadTemplate(
    "template.html",
    htmlContent,
    analysisHTML,
  );

  const outputFile = "index.html";
  await Deno.writeTextFile(outputFile, htmlDocument);
  console.log(`✅ ${outputFile}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("⛔ Error:", error.message);
    Deno.exit(1);
  });
}
