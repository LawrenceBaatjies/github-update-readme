const core = require("@actions/core");
const { Octokit } = require('@octokit/core')
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

(async () => {
  try {
    const REPO_COUNT = parseInt(core.getInput('repoCount'))
    const REPOS_PER_ROW = parseInt(core.getInput('reposPerRow'))
    const IMAGE_SIZE = parseInt(core.getInput('imageSize'))

    const username = process.env.GITHUB_REPOSITORY.split("/")[0]
    const repo = process.env.GITHUB_REPOSITORY.split("/")[1]
    const getReadme = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: username,
      repo: repo,
      path: core.getInput('path'),
    }).catch(e => {
      console.error("Failed: ", e)
      core.setFailed("Failed: ", e.message)
    })
    const sha = getReadme.data.sha

    let recentReposHaveImage = []
    let recentRepos = new Set()
    // const lastPage = (await octokit.request(`GET /users/{username}/events/public?per_page=100&page=last`)).headers
    for (let i = 0; recentRepos.size < REPO_COUNT && i < 10; i++) {
      core.log(i)
      const getActivity = await octokit.request(`GET /users/{username}/events/public?per_page=100&page=${i}`, {
        username: username,
      }).catch(e => {
        console.error("Failed: ", e)
        core.setFailed("Failed: ", e.message)
      })
      for (const value of getActivity.data) {
        let activityRepo = value.repo.name
        if (value.type === "ForkEvent") activityRepo = value.payload.forkee.full_name
        if (!JSON.parse(core.getInput('excludeActivity')).includes(value.type) && !JSON.parse(core.getInput('excludeRepo')).includes(activityRepo)) {
          recentRepos.add(activityRepo)
        }
        if (recentRepos.size >= REPO_COUNT) break
      }
    }

    for (const repo of recentRepos) {
      await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: repo.split("/")[0],
        repo: repo.split("/")[1],
        path: 'DISPLAY.jpg',
      }).then(() => {
        recentReposHaveImage.push(true)
      }).catch(e => {
        recentReposHaveImage.push(false)
      })
    }

    const data = core.getInput("customReadmeFile").replace(/\${\w{0,}}/g, (match) => {
      switch (match) {
        case "${repoTable}": return chunkArray(Array.from(recentRepos), REPOS_PER_ROW).map((value, row) => {
          return `|${value.map(value => ` [${value}](https://github.com/${value}) |`)}
|${value.map(() => ` :-: |`)}
|${value.map((value, col) => ` <a href="https://github.com/${value}"><img src="https://github.com/${recentReposHaveImage[row * REPOS_PER_ROW + col] ? value : `${username}/${repo}`}/raw/master/DISPLAY.jpg" alt="${value}" title="${value}" width="${IMAGE_SIZE}" height="${IMAGE_SIZE}"></a> |`
          )}\n\n`
        }).toString().replace(/,/g, "");
        case "${header}": return core.getInput('header')
        case "${subhead}": return core.getInput('subhead')
        case "${footer}": return core.getInput('footer')
        default:
          console.error(`${match} is not recognised`)
          return ""
      }
    })

    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner: username,
      repo: repo,
      path: core.getInput('path'),
      message: '(Automated) Update README.md',
      content: Buffer.from(data, "utf8").toString('base64'),
      sha: sha,
    }).then(() => {
      core.setOutput("repositories", Array.from(recentRepos))
    }).catch((e) => {
      console.error("Failed: ", e)
      core.setFailed("Failed: ", e.message)
    })

  } catch (e) {
    console.error("Failed: ", e)
    core.setFailed("Failed: ", e.message)
  }
})()

const chunkArray = (array, size) => {
  let chunked = []
  let index = 0
  while (index < array.length) {
    chunked.push(array.slice(index, size + index))
    index += size
  }
  return chunked
}