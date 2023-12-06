import { Buffer } from "node:buffer";
import { graphql } from "@octokit/graphql";
import { type RepositoryNode, gql } from "github-schema";
import ignore from "ignore";
import { minimatch } from "minimatch";
import {
  type Input,
  array,
  literal,
  number,
  object,
  optional,
  parseAsync,
  string,
  union,
} from "valibot";

import { SCHEMA } from "./schema";

export type ProjectRC = Input<typeof SCHEMA>;

export const REPOSITORY_QUERY = gql`
  #graphql
  query getRepository($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      name
      homepageUrl
      isFork
      isPrivate
      nameWithOwner
      description
      pushedAt
      url
      defaultBranchRef {
        name
      }
      languages(first: 1, orderBy: { field: SIZE, direction: DESC }) {
        nodes {
          name
          color
        }
      }
    }
  }
`;

export interface ReadmeResult {
  content: string
  path: string
}

export type ProjectRCResponse = {
  $projectrc: Input<typeof SCHEMA> & {
    $path: string
  }
} & {
  projects: (Omit<Input<typeof SCHEMA>, "monorepo" | "readme"> & {
    name: string
    readme?: ReadmeResult
  })[]
};

export const CONFIG_FILE_NAMES: string[] = [
  ".projectrc.json",
  ".projectrc",
  ".projectrc.json5",
];

const FileTreeSchema = array(
  object({
    mode: string(),
    path: string(),
    sha: string(),
    size: optional(number()),
    type: union([literal("tree"), literal("blob")]),
    url: string(),
  }),
);

export interface ProjectRCFile {
  content: Input<typeof SCHEMA>
  path: string
}

/**
 * Returns an object with methods to interact with a GitHub repository's ProjectRC file.
 * @param {string} githubToken - The GitHub token to use for authentication.
 * @returns An object with methods to interact with a GitHub repository's ProjectRC file.
 *
 * @example
 * ```ts
 * import { createProjectRCResolver } from "@luxass/projectrc";
 *
 * const projectRCResolver = createProjectRCResolver(process.env.GITHUB_TOKEN);
 *
 * // check if a repository exists
 * const exists = await projectRCResolver.exists("luxass", "projectrc");
 *
 * // get the repository's ProjectRC file
 * const projectRCFile = await projectRCResolver.config("luxass", "projectrc");
 *
 * // get the repository's readme
 * const readme = await projectRCResolver.readme("luxass", "projectrc");
 * ```
 */
export function createProjectRCResolver(githubToken: string) {
  return {
    /**
     * Find the projectrc file in the repository.
     * @param {string?} owner - The owner of the repository.
     * @param {string?} name - The name of the repository.
     * @returns {Promise<ProjectRCFile | undefined>} The projectrc file if any file was found otherwise `undefined`.
     *
     * @example
     * ```ts
     * import { createProjectRCResolver } from "@luxass/projectrc";
     *
     * const projectRCResolver = createProjectRCResolver(process.env.GITHUB_TOKEN);
     *
     * const projectRCFile = await projectRCResolver.config("luxass", "projectrc");
     * // results in:
     * // {
     * //   path: "https://api.github.com/repos/luxass/projectrc/contents/.github/.projectrc.json",
     * //   content: {
     * //     website: true,
     * //     handles: [
     * //       "/projectrc"
     * //     ],
     * //   }
     * // }
     * ```
     */
    async config(
      owner?: string,
      name?: string,
    ): Promise<ProjectRCFile | undefined> {
      if (!owner || !name) {
        return undefined;
      }

      for (const configFileName of CONFIG_FILE_NAMES) {
        try {
          const url = new URL(
            `https://api.github.com/repos/${owner}/${name}/contents/.github/${configFileName}`,
          );
          const result = await fetch(url.toString(), {
            headers: {
              "Authorization": `Bearer ${githubToken}`,
              "Content-Type": "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }).then((res) => res.json());

          if (
            !result
            || typeof result !== "object"
            || !("content" in result)
            || typeof result.content !== "string"
          ) {
            continue;
          }

          const content = JSON.parse(
            Buffer.from(result.content, "base64").toString("utf-8"),
          );

          const parsed = await parseAsync(SCHEMA, content);

          return {
            content: parsed,
            path: url.toString(),
          };
        } catch (err) {
          continue;
        }
      }
    },
    /**
     * Checks whether the given repository exists
     * @param {string} owner - The owner of the repository
     * @param {string} name - The name of the repository
     * @returns {Promise<boolean>} Whether the repository exists
     *
     * NOTE: This doesn't check whether the repository is public or private
     *
     * @example
     * ```ts
     * import { createProjectRCResolver } from "@luxass/projectrc";
     *
     * const projectRCResolver = createProjectRCResolver(process.env.GITHUB_TOKEN);
     *
     * await projectRCResolver.exists("luxass", "projectrc");
     * // true or false based on whether the repository exists
     * ```
     */
    async exists(owner?: string, name?: string): Promise<boolean> {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${name}`,
          {
            headers: {
              "Authorization": `bearer ${githubToken}`,
              "Content-Type": "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );

        if (!res.ok) {
          return false;
        }

        return true;
      } catch (err) {
        return false;
      }
    },
    /**
     * Fetches the readme content of a GitHub repository.
     * @param {string?} owner - The owner of the repository.
     * @param {string?} name - The name of the repository.
     * @param {string | boolean?} readmePath - The path to the readme file. If not provided, the default readme file will be fetched.
     * @returns A Promise that resolves to a ReadmeResult object containing the path and content of the readme file, or undefined if the readme could not be fetched.
     *
     * @example
     * ```ts
     * import { createProjectRCResolver } from "@luxass/projectrc";
     *
     * const projectRCResolver = createProjectRCResolver(process.env.GITHUB_TOKEN);
     *
     * const readme = await projectRCResolver.readme("luxass", "projectrc");
     * // results in:
     * // {
     * //   path: "https://api.github.com/repos/luxass/projectrc/contents/README.md",
     * //   content: "# ProjectRC\n\nProjectRC is a project configuration file for luxass.dev.\n",
     * // }
     * ```
     */
    async readme(
      owner?: string,
      name?: string,
      readmePath?: boolean | string,
    ): Promise<ReadmeResult | undefined> {
      if (!owner || !name) {
        return undefined;
      }
      const readmeUrl = new URL(
        `https://api.github.com/repos/${owner}/${name}`,
      );

      if (typeof readmePath === "string") {
        if (readmePath.startsWith("/")) {
          readmePath = readmePath.slice(1);
        }

        if (!readmePath.endsWith("README.md")) {
          readmePath += "/README.md";
        }

        readmeUrl.pathname += `/contents/${readmePath}`;
      } else {
        readmeUrl.pathname += "/readme";
      }

      try {
        const result = await fetch(readmeUrl.toString(), {
          headers: {
            "Authorization": `bearer ${githubToken}`,
            "Content-Type": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }).then((res) => res.json());

        if (
          !result
          || typeof result !== "object"
          || !("content" in result)
          || typeof result.content !== "string"
        ) {
          return undefined;
        }

        return {
          content: Buffer.from(result.content, "base64").toString("utf-8"),
          path: readmeUrl.toString(),
        };
      } catch (err) {
        return undefined;
      }
    },
    /**
     * Get a repository from GitHub
     * @param {string} owner - The owner of the repository
     * @param {string} name - The name of the repository
     * @returns {Promise<RepositoryNode["repository"]>} The `RepositoryNode` of the repository
     *
     * NOTE: This is not the full response from GitHub, as it only contains the fields we need.
     * To see what we request, you can see the `REPOSITORY_QUERY` export.
     *
     * @example
     * ```ts
     * import { createProjectRCResolver } from "@luxass/projectrc";
     *
     * const projectRCResolver = createProjectRCResolver(process.env.GITHUB_TOKEN);
     *
     * const repository = await projectRCResolver.repository("luxass", "projectrc");
     * // results in:
     * // {
     * //   name: "projectrc",
     * //   GITHUB RESPONSE...
     * // }
     * ```
     */
    async repository(
      owner?: string,
      name?: string,
    ): Promise<RepositoryNode["repository"] | undefined> {
      try {
        const { repository } = await graphql<RepositoryNode>(REPOSITORY_QUERY, {
          headers: {
            "Authorization": `bearer ${githubToken}`,
            "Content-Type": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          name,
          owner,
        });

        return repository;
      } catch (err) {
        return undefined;
      }
    },
    /**
     * Resolves a projectrc configuration for the given owner and name.
     * @param {string} owner - The owner of the repository.
     * @param {string} name - The name of the repository.
     * @returns {Promise<ProjectRCResponse | undefined>} A Promise that resolves to a ProjectRCResponse object if the configuration exists, otherwise undefined.
     *
     * @example
     * ```ts
     * import { createProjectRCResolver } from "@luxass/projectrc";
     *
     * const projectRCResolver = createProjectRCResolver(process.env.GITHUB_TOKEN);
     *
     * const projectRC = await projectRCResolver.resolve("luxass", "projectrc");
     * // results in:
     * // {
     * //   $projectrc: {
     * //     website: true,
     * //     handles: [
     * //       "/projectrc"
     * //     ],
     * //     $path: "https://api.github.com/repos/luxass/projectrc/contents/.github/.projectrc.json",
     * //   },
     * //   projects: [
     * //     {
     * //       name: "projectrc",
     * //       handles: [
     * //         "/projectrc"
     * //       ],
     * //       website: "https://luxass.dev/projectrc",
     * //     }
     * //   ]
     * // }
     * ```
     */
    async resolve(
      owner?: string,
      name?: string,
    ): Promise<ProjectRCResponse | undefined> {
      if (!owner || !name) {
        return undefined;
      }

      if (!(await this.exists(owner, name))) {
        return undefined;
      }

      const projectRCFile = await this.config(owner, name);
      if (!projectRCFile) {
        return undefined;
      }

      const repository = await this.repository(owner, name);
      if (!repository) {
        return undefined;
      }

      const { content: $raw } = projectRCFile;

      if ($raw.ignore) {
        return undefined;
      }

      const result: ProjectRCResponse = {
        $projectrc: {
          ...$raw,
          $path: projectRCFile.path,
        },
        projects: [],
      };

      if ($raw.monorepo && $raw.monorepo.enabled) {
        const pkgResult = await fetch(
          `https://api.github.com/repos/${owner}/${name}/contents/package.json`,
          {
            headers: {
              "Authorization": `bearer ${githubToken}`,
              "Content-Type": "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        ).then((res) => res.json());

        if (
          !pkgResult
          || typeof pkgResult !== "object"
          || !("content" in pkgResult)
          || typeof pkgResult.content !== "string"
        ) {
          throw new Error(
            "projectrc: monorepo is enabled, but no `package.json` file was found.\nPlease add a `package.json` file to the root of your repository.",
          );
        }

        const pkg: unknown = JSON.parse(
          Buffer.from(pkgResult.content, "base64").toString("utf-8"),
        );

        if (
          !pkg
          || typeof pkg !== "object"
          || !("workspaces" in pkg)
          || !Array.isArray(pkg.workspaces)
        ) {
          throw new Error(
            "projectrc: monorepo is enabled, but no workspaces are defined in your `package.json`.\nPlease add a `workspaces` field to your `package.json`.",
          );
        }

        // infer pkg.workspaces as a string array with if checks
        const workspaces = pkg.workspaces as string[];

        if (!workspaces.length) {
          throw new Error(
            "projectrc: monorepo is enabled, but no workspaces are defined in your `package.json`.\nPlease add a `workspaces` field to your `package.json`.",
          );
        }

        const filesResult = await fetch(
          `https://api.github.com/repos/${owner}/${name}/git/trees/main?recursive=1`,
          {
            headers: {
              "Authorization": `bearer ${githubToken}`,
              "Content-Type": "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        ).then((res) => res.json());

        if (!filesResult || typeof filesResult !== "object") {
          throw new Error(
            "projectrc: monorepo is enabled, but no files were found.\nPlease add files to your repository.",
          );
        }

        if (!("truncated" in filesResult) || filesResult.truncated) {
          throw new Error(
            "projectrc: monorepo is enabled, but the file tree is too large.\nWe are not currently supporting this.",
          );
        }

        if (
          !("tree" in filesResult)
          || !Array.isArray(filesResult.tree)
          || !filesResult.tree.length
        ) {
          throw new Error(
            "projectrc: monorepo is enabled, but no files were found.\nPlease add files to your repository.",
          );
        }

        const files = await parseAsync(FileTreeSchema, filesResult.tree);

        const filePaths = files.map((file) => file.path);
        const _ignore = ignore().add($raw.monorepo.ignores || []);

        const matchedFilePaths = filePaths.filter(
          (filePath) =>
            workspaces.some((pattern) => minimatch(filePath, pattern))
            && !_ignore.ignores(filePath),
        );

        const results = await Promise.all(
          matchedFilePaths.map(async (filePath) => {
            const url = `https://api.github.com/repos/${owner}/${name}/contents/${filePath}/package.json`;
            const file = await fetch(url, {
              headers: {
                "Authorization": `bearer ${githubToken}`,
                "Content-Type": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            }).then((res) => res.json());

            if (
              !file
              || typeof file !== "object"
              || !("content" in file)
              || typeof file.content !== "string"
            ) {
              throw new Error(
                `projectrc: could not find a \`content\` field in \`${url}\`.`,
              );
            }

            const pkg: unknown = JSON.parse(
              Buffer.from(file.content, "base64").toString("utf-8"),
            );

            if (
              !pkg
              || typeof pkg !== "object"
              || !("name" in pkg)
              || typeof pkg.name !== "string"
            ) {
              throw new Error(
                `projectrc: could not find a \`name\` field in \`${url}\`.`,
              );
            }

            let _private = false;

            if ("private" in pkg && typeof pkg.private === "boolean") {
              _private = pkg.private;
            }

            return {
              name: pkg.name,
              path: filePath,
              private: _private,
            };
          }),
        );

        const overrides = $raw.monorepo.overrides || [];
        for (const pkg of results) {
          const override = overrides.find(
            (override) => override.name === pkg.name,
          );

          // if package is inside a folder that you want to include everytime (like `packages/*`),
          // but still want to ignore a specific package.
          if (override && override.ignore) {
            continue;
          }

          const project: ProjectRCResponse["projects"][0] = {
            description:
              override?.description
              || $raw.description
              || repository.description
              || undefined,
            name: pkg.name,
          };

          project.handles = override?.handles || $raw.handles;

          let website;

          if (override?.website && typeof override.website === "string") {
            website = override.website;
          } else if ($raw.website && typeof $raw.website === "string") {
            website = $raw.website;
          } else {
            website = repository.homepageUrl || null;
          }

          project.website = website;

          let readmeSrc = override?.readme || $raw.readme;

          if (typeof readmeSrc === "boolean") {
            // use package readmes if true
            readmeSrc = `/${pkg.path}/README.md`;
          }

          if (readmeSrc) {
            const readme = await this.readme(owner, name, readmeSrc);
            if (readme) {
              project.readme = readme;
            }
          }

          const npmSrc = override?.npm || $raw.npm;

          if (npmSrc && !pkg.private) {
            project.npm
              = typeof npmSrc === "string"
                ? npmSrc
                : `https://www.npmjs.com/package/${pkg.name}`;
          }

          project.deprecated = override?.deprecated || $raw.deprecated;

          result.projects.push(project);
        }
      } else {
        const project: ProjectRCResponse["projects"][0] = {
          description: $raw.description || repository.description || undefined,
          name: repository.name,
        };

        if ($raw.handles) {
          project.handles = $raw.handles;
        }

        if ($raw.website) {
          project.website
            = typeof $raw.website === "string"
              ? $raw.website
              : repository.homepageUrl || null;
        }

        if ($raw.readme) {
          const readme = await this.readme(owner, name, $raw.readme);
          if (readme) {
            project.readme = readme;
          }
        }

        if ($raw.npm) {
          const url = `https://api.github.com/repos/${owner}/${name}/contents/package.json`;
          const file = await fetch(url, {
            headers: {
              "Authorization": `bearer ${githubToken}`,
              "Content-Type": "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }).then((res) => res.json());

          if (
            !file
            || typeof file !== "object"
            || !("content" in file)
            || typeof file.content !== "string"
          ) {
            throw new Error(
              `projectrc: could not find a \`content\` field in \`${url}\`.`,
            );
          }

          const pkg: unknown = JSON.parse(
            Buffer.from(file.content, "base64").toString("utf-8"),
          );

          if (
            !pkg
            || typeof pkg !== "object"
            || !("name" in pkg)
            || typeof pkg.name !== "string"
          ) {
            throw new Error(
              `projectrc: could not find a \`name\` field in \`${url}\`.`,
            );
          }
          project.npm
            = typeof $raw.npm === "string"
              ? $raw.npm
              : `https://www.npmjs.com/package/${pkg.name}`;
        }

        if ($raw.ignore) {
          throw new Error("projectrc: how did you get here?");
        }

        if ($raw.deprecated) {
          project.deprecated = $raw.deprecated;
        }

        result.projects.push(project);
      }

      return result;
    },
  };
}
