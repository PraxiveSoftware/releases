import "dotenv/config";
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { Octokit } from "octokit";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: GITHUB_TOKEN });

const browserBranch = "main";
const browserFolder = path.resolve(process.cwd(), "browser");
console.log(`Browser folder is: ${browserFolder}`);
let currentVersion = "v1.0.0";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const downloadRepo = async (tree_sha, folderPath = browserFolder) => {
    console.log(`Downloading browser source code from tree ${tree_sha} to ${folderPath}...`);
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

    console.log(`Downloaded browser source code from tree ${tree_sha} to ${folderPath}.`);
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
                        console.log("Built the browser.");
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
                const packageJson = JSON.parse(fs.readFileSync(path.join(browserFolder, 'package.json'), 'utf8'));
                const version = packageJson.version;
                currentVersion = version;

                const versionFolder = path.join(browserFolder, 'version', version);
                if (!fs.existsSync(versionFolder)) {
                    fs.mkdirSync(versionFolder, { recursive: true });
                }

                const nsisWebFolder = path.join(browserFolder, 'dist', 'nsis-web');
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
                    console.log("Created the installers for Windows.");
                    resolve();
                }
            }
        });
    });
};

const createTag = async (commitSha) => {
    const { data: tag } = await octokit.git.createTag({
        owner: "PraxiveSoftware",
        repo: "releases",
        tag: currentVersion,
        message: `${currentVersion}`,
        object: commitSha,
        type: 'commit',
        tagger: {
            name: 'Jonas Franke',
            email: 'jonasfranke@sdevs.org',
            date: new Date().toISOString()
        }
    });

    const { data: { ref } } = await octokit.git.createRef({
        owner: "PraxiveSoftware",
        repo: "releases",
        ref: `refs/tags/${currentVersion}`,
        sha: tag.sha
    });

    console.log(`Created tag ${currentVersion}.`);
    return ref;
}

const createRelease = async (commitSha) => {
    const tag = await createTag(commitSha);

    const { data: { id } } = await octokit.request("POST /repos/{owner}/{repo}/releases", {
        owner: "PraxiveSoftware",
        repo: "releases",
        tag_name: tag,
        name: currentVersion,
        prerelease: true
    });

    console.log(`Created the release with id ${id}.`);
    return id;
}

const main = async () => {
    const { data: { object: { sha } } } = await octokit.request("GET /repos/{owner}/{repo}/git/refs/{ref}", {
        owner: "PraxiveSoftware",
        repo: "browser",
        ref: `heads/${browserBranch}`
    });

    console.log(`Building the browser for commit ${sha}...`);
    await downloadRepo(sha);
    console.log("Downloaded the browser source code. Building the browser now...");
    await buildBrowser();
    console.log("Creating the installers now...");
    await createInstallers();
    console.log("Created the installers. Checking if the release already exists...");

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
        releaseId = await createRelease(sha);
        console.log(`Created the release with id ${releaseId}.`);
    }

    if (!existingRelease) {
        console.log(`Release with tag ${currentVersion} does not exist. Creating new release.`);
        releaseId = await createRelease();
        console.log(`Created the release with id ${releaseId}. Waiting for the release to be available...`);
        await delay(5000)
    }

    console.log("Uploading files to the release now.");
    const versionFolder = path.join(browserFolder, 'dists', 'nsis-web');
    const files = fs.readdirSync(versionFolder).filter(file => path.extname(file) !== '.yml');
    for (const file of files) {
        const filePath = path.join(versionFolder, file);
        const content = fs.readFileSync(filePath);
        await octokit.request("POST /repos/{owner}/{repo}/releases/{release_id}/assets?name={name}", {
            owner: "PraxiveSoftware",
            repo: "releases",
            release_id: releaseId,
            name: file,
            data: content
        });
    }
}

main().catch(console.error);