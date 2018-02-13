import {readFileSync, writeFileSync} from "fs";
import * as ts from "typescript";
import { VariableDeclaration, Diagnostic, CompilerHost } from "typescript";

const TRIG_FUNCTIONS = {
    'sin': 'sin',
    'cos': 'cos',
    'tan': 'tan',
};

function ensureFixedPoint(node: ts.Expression): ts.Expression {
    if (ts.SyntaxKind.NumericLiteral === node.kind) return node;
    if (ts.isBinaryExpression(node)) return rewriteBinaryExpression(node);
    if (ts.isCallExpression(node)) return rewriteCallExpression(node);
    throw new Error('Don\'t know what to do with this node: ' + ts.SyntaxKind[node.kind]);
}

function rewriteBinaryExpression(node: ts.BinaryExpression): ts.Expression {
    let operatorToken = node.operatorToken;

    let operator;
    switch (operatorToken.kind) {
        case ts.SyntaxKind.SlashToken:
            operator = 'div'; break;
        case ts.SyntaxKind.AsteriskToken:
            operator = 'times'; break;
        case ts.SyntaxKind.PlusToken:
            operator = 'plus'; break;
        case ts.SyntaxKind.MinusToken:
            operator = 'minus'; break;
        default:
            return node;
    }
    
    let left = ensureFixedPoint(node.left);
    let right = ensureFixedPoint(node.right);

    return ts.createCall(
        ts.createPropertyAccess(
            ts.createNew(
                ts.createIdentifier('Decimal'),
                undefined,
                [left]
            ),
            ts.createIdentifier(operator)
        ),
        undefined,
        [right]
    );
}

function rewriteCallExpression(node: ts.CallExpression): ts.CallExpression {
    switch (node.expression.kind) {
        case ts.SyntaxKind.PropertyAccessExpression:
            let paExpression = node.expression as ts.PropertyAccessExpression;
            let namespace;
            if (paExpression.expression.kind === ts.SyntaxKind.Identifier)
                namespace = (paExpression.expression as ts.Identifier).escapedText;

            if (namespace !== 'Math') break;

            let method;
            if (paExpression.name.kind === ts.SyntaxKind.Identifier)
                method = (paExpression.name as ts.Identifier).escapedText;

            let decimalMethod = TRIG_FUNCTIONS[method];
            if (decimalMethod) {
                return ts.createCall(
                    ts.createPropertyAccess(
                        ts.createIdentifier('Decimal'),
                        ts.createIdentifier(decimalMethod),
                    ),
                    undefined,
                    node.arguments,
                );
            }
            break;
    }

    return node;
}

export function decimalify(sourceFile: ts.SourceFile) {
    function decimalifyChild(node: ts.Node, nodeParent?: ts.Node) {
        let expression;

        if (nodeParent) {
            switch(node.kind) {
                case ts.SyntaxKind.BinaryExpression:
                    expression = rewriteBinaryExpression(node as ts.BinaryExpression);
                    break;
                case ts.SyntaxKind.CallExpression:
                    expression = rewriteCallExpression(node as ts.CallExpression);
                    break;
            }

            if (expression && expression !== node) switch (nodeParent.kind) {
                case ts.SyntaxKind.VariableDeclaration:
                    (nodeParent as ts.VariableDeclaration).initializer = expression;
                    break;
                case ts.SyntaxKind.CallExpression:
                    console.log(expression);
                    (nodeParent as ts.CallExpression).arguments = ts.createNodeArray<ts.Expression>([expression]);
                    break;
            }
        }

        let finalNode = expression || node;
        ts.forEachChild(finalNode, child => decimalifyChild(child, finalNode));
    }

    decimalifyChild(sourceFile);
}

function sourceFileHasDecimalJS(sourceFile: ts.SourceFile): boolean {
    let importExists = false;

    sourceFile.forEachChild((node: ts.Node) => {
        if (importExists) return;

        if (node.kind !== ts.SyntaxKind.ImportDeclaration) return;
        let importDeclaration = node as ts.ImportDeclaration;

        if (importDeclaration.moduleSpecifier.kind !== ts.SyntaxKind.StringLiteral) return;
        let moduleSpecifier = importDeclaration.moduleSpecifier as ts.StringLiteral;
        if (moduleSpecifier.text !== 'decimal.js') return;

        let { importClause } = importDeclaration;
        if (!importClause || importClause.kind !== ts.SyntaxKind.ImportClause) return;
        let { name } = importClause;
        if (!name || name.kind !== ts.SyntaxKind.Identifier) return;
        if (name.escapedText !== 'Decimal') return;

        importExists = true;
    });

    return importExists;
}

module.exports = function loader(source: string) {
    let sourceFile = ts.createSourceFile('source.js', source, ts.ScriptTarget.Latest);

    if (!sourceFileHasDecimalJS(sourceFile)) {
        sourceFile = ts.updateSourceFileNode(sourceFile, [
            ts.createImportDeclaration(
                undefined,
                undefined,
                ts.createImportClause(ts.createIdentifier('Decimal'), undefined),
                ts.createLiteral('decimal.js'),
            ),
            ...sourceFile.statements,
        ]);
    }

    decimalify(sourceFile);

    const printer = ts.createPrinter();
    const result = printer.printFile(sourceFile);
    return result;
}











function compile(fileNames: string[]): void {
    const options = {
        strict: true,
        noEmitOnError: true,
        noImplicitAny: false,
        target: ts.ScriptTarget.ES5,
        module: ts.ModuleKind.CommonJS,
    };

    let host = ts.createCompilerHost(options);

    host.getSourceFile = function getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, onError?: (message: string) => void) {
        const sourceText = ts.sys.readFile(fileName);
        let sourceFile = sourceText !== undefined ? ts.createSourceFile(fileName, sourceText, languageVersion) : undefined;
        if (sourceFile) decimalify(sourceFile);
        return sourceFile;
    }

    let program = ts.createProgram(fileNames, options, host);
    let emitResult = program.emit();

    let allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics as Diagnostic[]);

    allDiagnostics.forEach(diagnostic => {
        if (diagnostic.file) {
            let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
            let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
        }
        else {
            console.log(`${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
        }
    });

    let exitCode = emitResult.emitSkipped ? 1 : 0;
    process.exit(exitCode);
}

function prettyPrintSourceFile(sourceFile: ts.SourceFile) {
    let depth = 0;
    function prettyPrintChildNode(node: ts.Node, depth: number) {
        let spaces = '';
        for (var i = 0; i < depth*4-2; ++i) spaces+='-';
        process.stdout.write(' ' + spaces + ' ');
        process.stdout.write(ts.SyntaxKind[node.kind]);

        process.stdout.write('\n');
        ts.forEachChild(node, (node) => prettyPrintChildNode(node, depth+1));
    }

    prettyPrintChildNode(sourceFile, depth);
}

if (require && require.main === module) {
    compile(process.argv.slice(2));
}