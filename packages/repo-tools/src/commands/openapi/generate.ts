/*
 * Copyright 2023 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs-extra';
import YAML from 'js-yaml';
import chalk from 'chalk';
import { resolve } from 'path';
import { paths as cliPaths } from '../../lib/paths';
import { runner } from './runner';
import { TS_SCHEMA_PATH, YAML_SCHEMA_PATH } from './constants';
import { promisify } from 'util';
import { exec as execCb } from 'child_process';

const exec = promisify(execCb);

async function generate(
  directoryPath: string,
  config?: { skipMissingYamlFile: boolean },
) {
  const { skipMissingYamlFile } = config ?? {};
  const openapiPath = resolve(directoryPath, YAML_SCHEMA_PATH);
  if (!(await fs.pathExists(openapiPath))) {
    if (skipMissingYamlFile) {
      return;
    }
    throw new Error(`Could not find ${YAML_SCHEMA_PATH} in root of directory.`);
  }
  const yaml = YAML.load(await fs.readFile(openapiPath, 'utf8'));

  const tsPath = resolve(directoryPath, TS_SCHEMA_PATH);

  // The first set of comment slashes allow for the eslint notice plugin to run
  // with onNonMatchingHeader: 'replace', as is the case in the open source
  // Backstage repo. Otherwise the auto-generated comment will be removed by the
  // lint call below.
  await fs.writeFile(
    tsPath,
    `//

// ******************************************************************
// * THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY. *
// ******************************************************************
import {createValidatedOpenApiRouter} from '@backstage/backend-openapi-utils';
export const spec = ${JSON.stringify(yaml, null, 2)} as const;
export const createOpenApiRouter = async (
  options?: Parameters<typeof createValidatedOpenApiRouter>['1'],
) => createValidatedOpenApiRouter<typeof spec>(spec, options);
`,
  );

  await exec(`yarn backstage-cli package lint --fix ${tsPath}`);
  if (await cliPaths.resolveTargetRoot('node_modules/.bin/prettier')) {
    await exec(`yarn prettier --write ${tsPath}`);
  }
}

export async function bulkCommand(paths: string[] = []): Promise<void> {
  const resultsList = await runner(paths, (dir: string) =>
    generate(dir, { skipMissingYamlFile: true }),
  );

  let failed = false;
  for (const { relativeDir, resultText } of resultsList) {
    if (resultText) {
      console.log();
      console.log(
        chalk.red(
          `OpenAPI yaml to Typescript generation failed in ${relativeDir}:`,
        ),
      );
      console.log(resultText.trimStart());

      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  } else {
    console.log(chalk.green('Generated all files.'));
  }
}
