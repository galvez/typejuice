import { join, parse as parsePath } from 'path'
import { Plugin } from 'vite'
import TypeJuice from 'typejuice'

export default function VitePluginTypeJuice ({ typeRoot }) {
  return {
    name: 'vite-plugin-typejuice',
    enforce: 'pre',
    async transform (code, id) {
      if (!id.endsWith('.md')) {
        return null
      }
      const mdSource = fs.readFileSync(id, 'utf8')
      for (const line of mdSource.split(/\r?\n/)) {
        const includeMatch = line.match(/^<<< typejuice:(.+?)$/)
        if (includeMatch) {
          const typeDeclPath = join(typeRoot, includeMatch[1])
          const tj = new TypeJuice(typeDeclPath)
          code = `${
            code.slice(0, includeMatch.index)
          }${
            tj.toMarkdown()
          }${
            code.slice(includeMatch.index + includeMatch[1].length)
          }`
        }
      }
      return code
    },
  }
}
