// https://nitro.unjs.io/config
export default defineNitroConfig({
  runtimeConfig: {
    github: {
      token: "",
      username: "luxass",
    },
    worker: "http://localhost:8787",
    // eslint-disable-next-line node/prefer-global/process
    siteUrl: process.env.DEPLOY_URL ? process.env.URL : "http://localhost:3000",
  },
  preset: "cloudflare-pages",
  compatibilityDate: "2024-09-11",
  typescript: {
    strict: true,
    tsConfig: {
      compilerOptions: {
        skipLibCheck: true,
      },
    },
  },
  errorHandler: "~/error-handler",
});
