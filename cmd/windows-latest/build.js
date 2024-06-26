import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: GITHUB_TOKEN });

const browserBranch = "main";
const browserFolder = path.resolve(process.cwd(), "browser");
console.log(`Browser folder is: ${browserFolder}`);
let currentVersion = "v1.0.0";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const downloadRepo = async (tree_sha, folderPath = browserFolder) => {
  try {
    const {
      data: { tree },
    } = await octokit.request(
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      {
        owner: "PraxiveSoftware",
        repo: "browser",
        tree_sha: tree_sha,
      },
    );

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    for (const item of tree) {
      const filePath = path.resolve(folderPath, item.path);

      if (item.type === "tree") {
        fs.mkdirSync(filePath, { recursive: true });
        await downloadRepo(item.sha, filePath);
      } else if (item.type === "blob") {
        try {
          const {
            data: { content },
          } = await octokit.request(
            "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
            {
              owner: "PraxiveSoftware",
              repo: "browser",
              file_sha: item.sha,
            },
          );

          fs.writeFileSync(filePath, Buffer.from(content, "base64"));
        } catch (error) {
          if (error.status === 404) {
            console.warn(
              `Warning: File ${item.path} is a directory. Already downloaded, skipping...`,
            );
          } else {
            throw error;
          }
        }
      }
    }
  } catch (error) {
    if (
      error.status === 403 &&
      error.response.data.message.startsWith("API rate limit exceeded")
    ) {
      const resetTime = error.response.headers["x-ratelimit-reset"];
      const waitTime = resetTime - Math.floor(Date.now() / 1000);
      console.log(`Rate limit exceeded. Waiting for ${waitTime} seconds...`);
      await delay(waitTime * 1000);
      return downloadRepo(tree_sha, folderPath);
    } else {
      throw error;
    }
  }
};

const downloadRepoFuncMinors = async (
  tree_sha,
  folderPath = browserFolder,
  minor,
  isRecursiveCall = false,
) => {
  try {
    const {
      data: { tree },
    } = await octokit.request(
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
      {
        owner: "PraxiveSoftware",
        repo: minor,
        tree_sha: tree_sha,
      },
    );

    const minorPath = isRecursiveCall
      ? folderPath
      : path.resolve(folderPath, "packages", minor);

    if (!fs.existsSync(minorPath)) {
      fs.mkdirSync(minorPath, { recursive: true });
    }

    for (const item of tree) {
      let filePath = path.resolve(minorPath, item.path);

      if (item.type === "tree") {
        if (!fs.existsSync(filePath)) {
          fs.mkdirSync(filePath, { recursive: true });
        }
        await downloadRepoFuncMinors(item.sha, filePath, minor, true);
      } else if (item.type === "blob") {
        try {
          const {
            data: { content },
          } = await octokit.request(
            "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
            {
              owner: "PraxiveSoftware",
              repo: minor,
              file_sha: item.sha,
            },
          );

          fs.writeFileSync(filePath, Buffer.from(content, "base64"));
        } catch (error) {
          if (error.status === 404) {
            console.warn(
              `Warning: File ${item.path} is a directory. Already downloaded, skipping...`,
            );
          } else {
            throw error;
          }
        }
      }
    }
  } catch (error) {
    if (
      error.status === 403 &&
      error.response.data.message.startsWith("API rate limit exceeded")
    ) {
      const resetTime = error.response.headers["x-ratelimit-reset"];
      const waitTime = resetTime - Math.floor(Date.now() / 1000);
      console.log(`Rate limit exceeded. Waiting for ${waitTime} seconds...`);
      await delay(waitTime * 1000);
      return downloadRepoFuncMinors(
        tree_sha,
        folderPath,
        minor,
        isRecursiveCall,
      );
    } else {
      throw error;
    }
  }
};

const downloadMinorRepos = async (folderPath = browserFolder) => {
  try {
    const minors = ["domain-fetch", "pdf-viewer", "print-viewer"];
    const minorsPath = path.resolve(folderPath, "packages");

    if (!fs.existsSync(minorsPath)) {
      fs.mkdirSync(minorsPath, { recursive: true });
    }

    for (const minor of minors) {
      console.log(`Downloading the ${minor} repo...`);
      const {
        data: {
          object: { sha },
        },
      } = await octokit.request("GET /repos/{owner}/{repo}/git/refs/{ref}", {
        owner: "PraxiveSoftware",
        repo: minor,
        ref: "heads/main",
      });

      await downloadRepoFuncMinors(sha, folderPath, minor);
      console.log(`Downloaded the ${minor} repo.`);

      if (minor !== "pdf-viewer") {
        console.log(`Installing dependencies for ${minor}...`);
        await new Promise((resolve, reject) => {
          exec("yarn", { cwd: path.resolve(minorsPath, minor) }, (error) => {
            if (error) {
              console.error(
                `Error during dependency installation for ${minor}: ${error}`,
              );
              reject(error);
            } else {
              console.log(`Building ${minor}...`);
              exec(
                "yarn build",
                { cwd: path.resolve(minorsPath, minor) },
                (error) => {
                  if (error) {
                    console.error(`Error during build for ${minor}: ${error}`);
                    reject(error);
                  } else {
                    console.log(`Built ${minor}.`);
                    resolve();
                  }
                },
              );
            }
          });
        });
      }
    }
  } catch (error) {
    if (
      error.status === 403 &&
      error.response.data.message.startsWith("API rate limit exceeded")
    ) {
      const resetTime = error.response.headers["x-ratelimit-reset"];
      const waitTime = resetTime - Math.floor(Date.now() / 1000);
      console.log(`Rate limit exceeded. Waiting for ${waitTime} seconds...`);
      await delay(waitTime * 1000);
      return downloadMinorRepos(folderPath);
    } else {
      throw error;
    }
  }
};

const buildBrowser = () => {
  return new Promise((resolve, reject) => {
    console.log("Installing dependencies...");
    exec("yarn", { cwd: browserFolder }, (error) => {
      if (error) {
        console.error(`Error during dependency installation: ${error}`);
        reject(error);
      } else {
        console.log("Building the browser...");
        exec("yarn build", { cwd: browserFolder }, (error) => {
          if (error) {
            console.error(`Error during build: ${error}`);
            reject(error);
          } else {
            resolve();
          }
        });
      }
    });
  });
};

const createInstallers = async () => {
  return new Promise((resolve, reject) => {
    exec("yarn compile-windows", { cwd: browserFolder }, async (error) => {
      if (error) {
        console.error(`Error during compile: ${error}`);
        reject(error);
      } else {
        const packageJson = JSON.parse(
          fs.readFileSync(path.join(browserFolder, "package.json"), "utf8"),
        );
        const version = packageJson.version;
        currentVersion = version;

        const versionFolder = path.join(browserFolder, "version", version);
        if (!fs.existsSync(versionFolder)) {
          fs.mkdirSync(versionFolder, { recursive: true });
        }

        const nsisWebFolder = path.join(browserFolder, "dist", "nsis-web");
        if (!fs.existsSync(nsisWebFolder)) {
          console.error(
            `Error: ${nsisWebFolder} does not exist. The compile step may have failed or it may not have created this directory as expected.`,
          );
          reject(new Error(`Directory not found: ${nsisWebFolder}`));
        } else {
          const files = fs.readdirSync(nsisWebFolder);
          for (const file of files) {
            if (path.extname(file) !== ".yml") {
              const content = fs.readFileSync(path.join(nsisWebFolder, file));
              fs.writeFileSync(path.join(versionFolder, file), content);
            }
          }
          console.log("Created the installers for Windows.");
          resolve();
        }
      }
    });
  });
};

const createRelease = async () => {
  const {
    data: { id },
  } = await octokit.request("POST /repos/{owner}/{repo}/releases", {
    owner: "PraxiveSoftware",
    repo: "releases",
    tag_name: currentVersion,
    name: currentVersion,
    prerelease: true,
  });

  return id;
};

const main = async () => {
  try {
    const {
      data: {
        object: { sha },
      },
    } = await octokit.request("GET /repos/{owner}/{repo}/git/refs/{ref}", {
      owner: "PraxiveSoftware",
      repo: "browser",
      ref: `heads/${browserBranch}`,
    });

    console.log(`Downloading the browser repo source code from sha ${sha}...`);
    await downloadRepo(sha);
    console.log("Downloaded the browser source code.");
    console.log("Downloading the minor repos...");
    await downloadMinorRepos();
    console.log("Downloaded the minor repos.");
    await buildBrowser();
    console.log("Installed dependencies and built the browser.");
    console.log("Creating the installers now...");
    await createInstallers();
    console.log("Created the installers.");
    console.log("Checking if the release already exists...");

    const { data: releases } = await octokit.request(
      "GET /repos/{owner}/{repo}/releases",
      {
        owner: "PraxiveSoftware",
        repo: "releases",
      },
    );

    let releaseId;
    const existingRelease = releases.find(
      (release) => release.tag_name === currentVersion,
    );
    if (existingRelease) {
      console.log(
        `Release with tag ${currentVersion} already exists. Using existing release.`,
      );
      releaseId = existingRelease.id;
    } else {
      console.log(
        `Release with tag ${currentVersion} does not exist. Creating new release.`,
      );
      releaseId = await createRelease();
      console.log(`Created the release with id ${releaseId}.`);
    }

    console.log("Uploading files to the release now.");
    const versionFolder = path.join(browserFolder, "dist", "nsis-web");
    const files = fs.readdirSync(versionFolder);
    for (const file of files) {
      const filePath = path.join(versionFolder, file);
      const content = fs.readFileSync(filePath);
      await octokit.repos.uploadReleaseAsset({
        owner: "PraxiveSoftware",
        repo: "releases",
        release_id: releaseId,
        name: file,
        data: content,
      });
    }
  } catch (error) {
    if (
      error.status === 403 &&
      error.response.data.message.startsWith("API rate limit exceeded")
    ) {
      const resetTime = error.response.headers["x-ratelimit-reset"];
      const waitTime = resetTime - Math.floor(Date.now() / 1000);
      console.log(`Rate limit exceeded. Waiting for ${waitTime} seconds...`);
      await delay(waitTime * 1000);
      return main();
    } else {
      throw error;
    }
  }
};

main().catch(console.error);
