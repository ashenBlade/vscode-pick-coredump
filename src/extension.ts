import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

function getCoreDumpDirectory(): vscode.Uri {
	const config = vscode.workspace.getConfiguration('pick-coredump');
	const value = config.get<string>('coredump-dir');
	if (value?.trim()?.length) {
		return vscode.Uri.file(value);
	}

	/* it works on my pc */
	return vscode.Uri.file('/var/lib/apport/coredump');
}

async function searchCoreDumpFiles(directory: vscode.Uri) {
	const dir = await new Promise<fs.Dir>((resolve, reject) => {
		fs.opendir(directory.fsPath, (err, dir) => {
			if (err) {
				reject(err);
			} else {
				resolve(dir);
			}
		});
	});

	const files = [];
	for (let file = await dir.read(); !!file; file = await dir.read()) {
		/* accept only files */
		if (!file.isFile()) {
			continue;
		}

		files.push(path.join(file.parentPath, file.name));
	}

	await dir.close();
	return files;
}

async function getCreationTime(file: string) {
	return new Promise<number>((resolve, reject) => {
		fs.stat(file, (err, stat) => {
			if (err) {
				reject(err);
			} else {
				/*
				 * do not know if coredump can be changed after creation, so
				 * use only creation time, not modification
				 */
				resolve(stat.ctimeMs);
			}
		});
	});
}

async function getLatestCreatedFile(files: string[]) {
	let latest = files[0];
	let latestTime = await getCreationTime(files[0]);
	for (let i = 1; i < files.length; i++) {
		let f = files[i];
		let time = await getCreationTime(f);
		if (latestTime < time) {
			latest = f;
			latestTime = time;
		}
	}

	return latest;
}

export function activate(context: vscode.ExtensionContext) {
	const logger = vscode.window.createOutputChannel('Pick coredump', {log: true});

	logger.info('Extension is activating');
	context.subscriptions.push(
		vscode.commands.registerCommand('pick-coredump.search-coredump', async (args) => {
			try {
				const directory = getCoreDumpDirectory();
				logger.debug('coredump directory: ', directory.fsPath);
				const files = await searchCoreDumpFiles(directory);
				if (files.length === 0) {
					throw new Error('No coredump files in ' + directory.fsPath);
				}

				if (files.length === 1) {
					logger.info('choosing only found file ', files[0]);
					return files[0];
				}

				if (args?.chooseLatest) {
					return await getLatestCreatedFile(files);
				}

				/*
				 * Sort descening, because timestamp can be included in file
				 * pattern and we more likely want to debug latest core dump
				 */
				files.sort((a, b) => b.localeCompare(a));

				return await vscode.window.showQuickPick(files.map(f => ({label: f})), {
					canPickMany: false,
					title: 'Choose coredump file'
				});
			} catch (err) {
				logger.error(err as any);
				throw err;
			}
		}),
		logger,
	);
}

export function deactivate() {

}
