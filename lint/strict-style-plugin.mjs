const MUTATING_ARRAY_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
]);

const plugin = {
  meta: {
    name: 'local',
  },
  rules: {
    'no-comments': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow all comments in source and test files',
        },
        schema: [],
      },
      create(context) {
        return {
          Program() {
            const comments = context.sourceCode.getAllComments();
            for (const comment of comments) {
              context.report({
                loc: comment.loc,
                message: 'Comments are disallowed; prefer self-documenting code.',
              });
            }
          },
        };
      },
    },
    'no-let': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow mutable variable declarations (let/var); use const and pure expressions',
        },
        schema: [],
      },
      create(context) {
        return {
          VariableDeclaration(node) {
            if (node.kind === 'let' || node.kind === 'var') {
              context.report({
                node,
                message: `Mutable "${node.kind}" declarations are disallowed; prefer "const" and functional transforms.`,
              });
            }
          },
        };
      },
    },
    'no-array-mutation': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow in-place array mutations (push/pop/sort/splice/etc.)',
        },
        schema: [],
      },
      create(context) {
        return {
          CallExpression(node) {
            if (
              node.callee.type === 'MemberExpression' &&
              !node.callee.computed &&
              node.callee.property.type === 'Identifier' &&
              MUTATING_ARRAY_METHODS.has(node.callee.property.name)
            ) {
              context.report({
                node: node.callee.property,
                message: `Mutating method ".${node.callee.property.name}()" is disallowed; use immutable transforms (.map/.filter/.reduce/.toSorted/spread).`,
              });
            }
          },
        };
      },
    },
  },
};

export default plugin;
