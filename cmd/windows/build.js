import "dotenv/config";
import fs from 'node:fs';
import path from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { exec } from 'node:child_process';
import { Octokit } from "octokit";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const octokit = new Octokit({ auth: GITHUB_TOKEN });

const browserBranch = "main";

const browserFolder = path.resolve(__dirname, "..", "browser");

let currentVersion = "v1.0.0";

const downloadRepo = async () => {
    const { data: { tree } } = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
        owner: "PraxiveSoftware",
        repo: "browser",
        tree_sha: browserBranch
    });
    
    for (const item of tree) {
        if (item.type === "blob") {
        const { data: { content } } = await octokit.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
            owner: "PraxiveSoftware",
            repo: "browser",
            file_sha: item.sha
        });
    
        fs.writeFileSync(path.resolve(browserFolder, item.path), Buffer.from(content, "base64"));
        }
    }
};

const buildBrowser = async () => {
    return new Promise((resolve, reject) => {
        exec("yarn build", { cwd: browserFolder }, (err, stdout, stderr) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
};

const createInstallers = async () => {
    return new Promise((resolve, reject) => {
        exec("yarn compile-windows", { cwd: browserFolder }, (err, stdout, stderr) => {
            if (err) {
                reject(err);
                return;
            }

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

            resolve();
        });
    });
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

downloadRepo().then(() => {
    console.log("Downloaded the browser repo. Building the browser now for (Windows)");
    buildBrowser().then(() => {
        console.log("Built the browser for (Windows). Creating the installer now.");
        createInstallers().then(() => {
            console.log("Created the installers for (Windows). Creating new release now.");
            createRelease().then((releaseId) => {
                console.log(`Created the release with id ${releaseId}. Uploading files to the release now.`);
                const versionFolder = path.join(browserFolder, 'version', currentVersion);
                const files = fs.readdirSync(versionFolder);
                for (const file of files) {
                    const filePath = path.join(versionFolder, file);
                    const content = fs.readFileSync(filePath);
                    octokit.request("POST /repos/{owner}/{repo}/releases/{release_id}/assets?name={name}", {
                        owner: "PraxiveSoftware",
                        repo: "browser",
                        release_id: releaseId,
                        name: file,
                        data: content
                    });
                }
            });
        })
    });
});