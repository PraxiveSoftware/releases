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

const downloadRepo = async () => {
    const { data: { tree } } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
        owner: "PraxiveSoftware",
        repo: "browser",
        tree_sha: browserBranch
    });
    
    for (const item of tree) {
        const { data: { content } } = await octokit.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
            owner: "PraxiveSoftware",
            repo: "browser",
            file_sha: item.sha
        });

        const filePath = path.resolve(browserFolder, item.path);
        console.log(`Writing file: ${filePath}`);
        fs.writeFileSync(filePath, Buffer.from(content, "base64"));
    }
};

const buildBrowser = () => {
    return exec("yarn build", { cwd: browserFolder });
};

const createInstallers = async () => {
    await exec("yarn compile-linux", { cwd: browserFolder });

    const packageJson = JSON.parse(fs.readFileSync(path.join(browserFolder, 'package.json'), 'utf8'));
    const version = packageJson.version;
    currentVersion = version;

    const versionFolder = path.join(browserFolder, 'version', version);
    if (!fs.existsSync(versionFolder)) {
        fs.mkdirSync(versionFolder, { recursive: true });
    }

    const nsisWebFolder = path.join(browserFolder, 'dist', 'nsis-web');
    const files = fs.readdirSync(nsisWebFolder);
    for (const file of files) {
        if (path.extname(file) !== '.yml') {
            const content = fs.readFileSync(path.join(nsisWebFolder, file));
            fs.writeFileSync(path.join(versionFolder, file), content);
        }
    }
};

const createRelease = async () => {
    const { data: { id } } = await octokit.request("POST /repos/{owner}/{repo}/releases", {
        owner: "PraxiveSoftware",
        repo: "browser",
        tag_name: currentVersion,
        name: currentVersion,
        prerelease: true
    });

    return id;
}

const main = async () => {
    await downloadRepo();
    console.log("Downloaded the browser repo. Building the browser now for Linux.");
    await buildBrowser();
    console.log("Built the browser for Linux. Creating the installer now.");
    await createInstallers();
    console.log("Created the installers for Linux. Creating new release now.");
    const releaseId = await createRelease();
    console.log(`Created the release with id ${releaseId}. Uploading files to the release now.`);
    const versionFolder = path.join(browserFolder, 'version', currentVersion);
    const files = fs.readdirSync(versionFolder);
    for (const file of files) {
        const filePath = path.join(versionFolder, file);
        const content = fs.readFileSync(filePath);
        await octokit.request("POST /repos/{owner}/{repo}/releases/{release_id}/assets?name={name}", {
            owner: "PraxiveSoftware",
            repo: "browser",
            release_id: releaseId,
            name: file,
            data: content
        });
    }
}

main().catch(console.error);