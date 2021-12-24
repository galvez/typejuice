'use strict'

const fs = require('fs')
const { parse: parsePath } = require('path')
const ts = require('typescript')
const wrap = require('word-wrap')

const keywordMap = {
  StringKeyword: 'string',
  NumberKeyword: 'number',
  BooleanKeyword: 'boolean',
  NullKeyword: 'null',
  UndefinedKeyword: 'undefined',
  ObjectKeyword: 'object',
}

const kSourceBody = Symbol('kSourceBody')

class TypeJuice {
  constructor (path) {
    const { name: sourceName } = parsePath(path)
    this[kSourceBody] = fs.readFileSync(path, 'utf8')
    const sourceNode = ts.createSourceFile(
      sourceName,
      this[kSourceBody],
      ts.ScriptTarget.Latest,
    )
    this.structure = this.extractStructure(sourceNode)
  }

  extractStructure (node, sourceMeta) {
    if (node.kind !== ts.SyntaxKind.SourceFile && node.kind !== ts.SyntaxKind.ModuleBlock) {
      throw new Error('node kind must be either SourceFile or ModuleBlock.')
    }
    if (!sourceMeta) {
      sourceMeta = []
    }
    for (const statement of node.statements) {
      switch (statement.kind) {
        case ts.SyntaxKind.InterfaceDeclaration:
          sourceMeta.push(['Interface', this.extractInterface(statement)])
          break
        case ts.SyntaxKind.ClassDeclaration:
          sourceMeta.push(['Class', this.extractClass(statement)])
          break
        case ts.SyntaxKind.FunctionDeclaration:
          sourceMeta.push(['Function', this.extractFunction(statement)])
          break
        case ts.SyntaxKind.ModuleDeclaration:
          sourceMeta.push(...this.extractStructure(statement.body))
          break
        default:
          // console.log(ts.SyntaxKind[statement.kind])
          break
      }
    }
    return sourceMeta
  }

  extractInterface (iNode) {
    const interfaceProps = []
    const interfaceMeta = {
      name: iNode.name.escapedText,
      props: interfaceProps,
    }
    for (const member of iNode.members) {
      switch (member.kind) {
        case ts.SyntaxKind.PropertySignature:
          interfaceProps.push(this.extractNodeMeta(member))
        default:
          break
      }
    }
    return interfaceMeta
  }

  extractClass (classNode) {
    const classProps = []
    const classMeta = {
      name: classNode.name.escapedText,
      constructorMeta: null,
      props: classProps,
    }
    for (const member of classNode.members) {
      switch (member.kind) {
        case ts.SyntaxKind.Constructor:
          classMeta.constructorMeta = this.extractConstructor(member)
          break
        case ts.SyntaxKind.PropertyDeclaration:
          classProps.push(this.extractNodeMeta(member))
          break
        default:
          break
      }
    }
    return classMeta
  }

  extractConstructor (member) {
    const params = []
    const comments = []
    for (const param of member.parameters) {
      params.push(this.extractNodeMeta(param))
    }
    this.extractNodeComments(member, comments)
    return { params, comments }
  }

  extractFunction (functionNode) {
    const functionParams = []
    const functionMeta = {
      name: functionNode.name.escapedText,
      params: functionParams,
      returnTypes: this.extractNodeTypes(functionNode),
    }
    for (const param of functionNode.parameters) {
      functionParams.push(this.extractNodeMeta(param))
    }
    return functionMeta
  }

  extractNodeMeta (node) {
    const comments = []
    const nodeMeta = [node.name.escapedText, {
      optional: !!node.questionToken,
      types: this.extractNodeTypes(node),
      comments,
    }]
    this.extractNodeComments(node, comments)
    return nodeMeta
  }

  extractNodeTypes (node) {
    const nodeTypes = []
    if (node.type.types) {
      for (const type of node.type.types) {
        if (type.typeName) {
          nodeTypes.push(this.extractTypeName(type.typeName))
        } else {
          if (type.literal) {
            nodeTypes.push(keywordMap[ts.SyntaxKind[type.literal.kind]])
          } else {
            nodeTypes.push(keywordMap[ts.SyntaxKind[type.kind]])
          }
        }
      }
    } else {
      if (node.type.typeName) {
        nodeTypes.push([this.extractTypeName(node.type.typeName)])
      } else {
        if (node.type.literal) {
          nodeTypes.push([keywordMap[ts.SyntaxKind[node.type.literal.kind]]])
        } else {
          nodeTypes.push([keywordMap[ts.SyntaxKind[node.type.kind]]])
        }
      }
    }
    return nodeTypes
  }

  extractTypeName (typeName) {
    if (typeName.escapedText) {
      return typeName.escapedText
    }
    let result = ''
    if (typeName.left) {
      if (typeName.left.left) {
        result += this.extractTypeName(typeName.left.left)
        result += `.${this.extractTypeName(typeName.left.right)}`
      } else {
        if (result) {
          result += '.'
        }
        result += `${typeName.left.escapedText}`
      }
      if (result) {
        result += '.'
      }
      result += `${typeName.right.escapedText}`
    }
    return result
  }

  extractNodeComments (node, comments) {
    const { pos, end } = node
    const commentText = ''
    let seenComment = false
    let lineBreak = false
    for (const line of this[kSourceBody].slice(pos, end).split(/\r?\n/)) {
      const commentMatch = line.match(/^\s*\/\/(.+?)$/)
      if (commentMatch) {
        seenComment = true
        if (!lineBreak && comments.length) {
          comments[comments.length - 1] += ` ${commentMatch[1].trim()}`
        } else {
          comments.push(`${commentMatch[1].trim()}`)
        }
        lineBreak = false
      } else if (line.match(/^\s*$/)) {
        lineBreak = true
      } else if (!lineBreak && seenComment) {
        break
      }
    }
    return wrap(comments.join('\n\n'), { width: 80 })
  }

  toMarkdown () {
    let markdown = ''
    for (const [kind, meta] of this.structure) {
      if (markdown.length) {
        markdown += '\n'
      }
      markdown += `## ${kind}: ${meta.name}\n`
      if (meta.constructorMeta) {
        if (meta.constructorMeta.comments) {
          markdown += '\n'
          markdown += `${meta.constructorMeta.comments.join('\n\n')}\n`
        }
        markdown += '\n'
        markdown += this.addParamsToMarkdown(meta.constructorMeta.params)
      }
      if (meta.params) {
        markdown += '\n'
        markdown += '### Parameters\n'
        if (meta.params.length) {
          markdown += '\n'
          markdown += this.addParamsToMarkdown(meta.params)
        }
      }
      if (meta.props && meta.props.length) {
        markdown += '\n'
        markdown += '### Properties\n'
        markdown += '\n'
        markdown += this.addParamsToMarkdown(meta.props)
      }
    }
    return markdown
  }

  addParamsToMarkdown (params) {
    let markdown = ''
    for (const [paramName, paramMeta] of params) {
      markdown += `- **\`${paramName}\`**: ${
        paramMeta.types.map(type => `**${type}**`).join(' | ')
      }`
      if (paramMeta.optional) {
        markdown += ' (optional)'
      }
      if (paramMeta.comments.length) {
        markdown += `\n  ${paramMeta.comments.join(' ')}`
        // markdown += '\n'
      }
      markdown += '\n'
    }
    return markdown
  }
}

module.exports = TypeJuice
