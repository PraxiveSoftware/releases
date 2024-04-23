import "dotenv/config";
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { Octokit } from "@octokit/rest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: GITHUB_TOKEN });

const browserBranch = "main";
const browserFolder = path.resolve(process.cwd(), "browser");
console.log(`Browser folder is: ${browserFolder}`);
let currentVersion = "v1.0.0";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const downloadRepo = async (tree_sha, folderPath = browserFolder) => {
    const { data: { tree } } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
        owner: "PraxiveSoftware",
        repo: "browser",
        tree_sha: tree_sha
    });
    
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
                const { data: { content } } = await octokit.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
                    owner: "PraxiveSoftware",
                    repo: "browser",
                    file_sha: item.sha
                });

                fs.writeFileSync(filePath, Buffer.from(content, "base64"));
            } catch (error) {
                if (error.status === 404) {
                    console.warn(`Warning: File ${item.path} is a directory. Already downloaded, skipping...`);
                } else {
                    throw error;
                }
            }
        }
    }
};

const downloadMinorRepos = async (tree_sha, folderPath = browserFolder) => {
    const minors = ["domain-fetch", "pdf-viewer", "print-viewer"];
    const minorsPath = path.resolve(folderPath, "packages");

    if (!fs.existsSync(minorsPath)) {
        fs.mkdirSync(minorsPath, { recursive: true });
    }

    for (const minor of minors) {
        const { data: { tree } } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
            owner: "PraxiveSoftware",
            repo: minor,
            tree_sha: tree_sha
        });

        const minorPath = path.resolve(minorsPath, minor);

        if (!fs.existsSync(minorPath)) {
            fs.mkdirSync(minorPath, { recursive: true });
        }

        for (const item of tree) {
            const filePath = path.resolve(minorPath, item.path);

            if (item.type === "tree") {
                fs.mkdirSync(filePath, { recursive: true });
                await downloadRepo(item.sha, filePath);
            } else if (item.type === "blob") {
                try {
                    const { data: { content } } = await octokit.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
                        owner: "PraxiveSoftware",
                        repo: minor,
                        file_sha: item.sha
                    });

                    fs.writeFileSync(filePath, Buffer.from(content, "base64"));
                } catch (error) {
                    if (error.status === 404) {
                        console.warn(`Warning: File ${item.path} is a directory. Already downloaded, skipping...`);
                    } else {
                        throw error;
                    }
                }
            }
        }
    }
};

const buildBrowser = () => {
    return new Promise((resolve, reject) => {
        console.log("Checking if yarn is installed...");
        exec("yarn --version", (error) => {
            if (error) {
                console.error(`Yarn is not installed: ${error}`);
                reject(error);
            } else {
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
            }
        });
    });
};

const createInstallers = async () => {
    return new Promise((resolve, reject) => {
        exec(`yarn compile-linux`, { cwd: browserFolder }, async (error) => {
            if (error) {
                console.error(`Error during compile: ${error}`);
                reject(error);
            } else {
                const packageJson = JSON.parse(fs.readFileSync(path.join(browserFolder, 'package.json'), 'utf8'));
                const version = packageJson.version;
                currentVersion = version;

                const versionFolder = path.join(browserFolder, 'version', version);
                if (!fs.existsSync(versionFolder)) {
                    fs.mkdirSync(versionFolder, { recursive: true });
                }

                const nsisWebFolder = path.join(browserFolder, 'dist');
                if (!fs.existsSync(nsisWebFolder)) {
                    console.error(`Error: ${nsisWebFolder} does not exist. The compile step may have failed or it may not have created this directory as expected.`);
                    reject(new Error(`Directory not found: ${nsisWebFolder}`));
                } else {
                    const files = fs.readdirSync(nsisWebFolder);
                    for (const file of files) {
                        if (path.extname(file) !== '.yml') {
                            const content = fs.readFileSync(path.join(nsisWebFolder, file));
                            fs.writeFileSync(path.join(versionFolder, file), content);
                        }
                    }
                    console.log("Created the installers for Linux.");
                    resolve();
                }
            }
        });
    });
};

const createRelease = async () => {
    const { data: { id } } = await octokit.request("POST /repos/{owner}/{repo}/releases", {
        owner: "PraxiveSoftware",
        repo: "releases",
        tag_name: "v" + currentVersion,
        name: "v" + currentVersion,
        prerelease: true
    });

    return id;
}

const main = async () => {
    const { data: { object: { sha } } } = await octokit.request("GET /repos/{owner}/{repo}/git/refs/{ref}", {
        owner: "PraxiveSoftware",
        repo: "browser",
        ref: `heads/${browserBranch}`
    });

    console.log(`Downloading the browser repo source code from sha ${sha}...`);
    await downloadRepo(sha);
    console.log("Downloaded the browser source code.");
    console.log("Downloading the minor repos...");
    await downloadMinorRepos(sha);
    console.log("Downloaded the minor repos.");
    await buildBrowser();
    console.log("Installed dependencies and built the browser.");
    console.log("Creating the installers now...");
    await createInstallers();
    console.log("Created the installers.");
    console.log("Checking if the release already exists...");

    const { data: releases } = await octokit.request("GET /repos/{owner}/{repo}/releases", {
        owner: "PraxiveSoftware",
        repo: "releases"
    });

    let releaseId;
    const existingRelease = releases.find(release => release.tag_name === currentVersion);
    if (existingRelease) {
        console.log(`Release with tag ${currentVersion} already exists. Using existing release.`);
        releaseId = existingRelease.id;
    } else {
        console.log(`Release with tag ${currentVersion} does not exist. Creating new release.`);
        releaseId = await createRelease();
        console.log(`Created the release with id ${releaseId}.`);
    }

    console.log("Uploading files to the release now.");
    const versionFolder = path.join(browserFolder, 'dist', 'nsis-web');
    const files = fs.readdirSync(versionFolder);
    for (const file of files) {
        const filePath = path.join(versionFolder, file);
        const content = fs.readFileSync(filePath);
        await octokit.repos.uploadReleaseAsset({
            owner: "PraxiveSoftware",
            repo: "releases",
            release_id: releaseId,
            name: file,
            data: content
        });
    }
}

main().catch(console.error);
