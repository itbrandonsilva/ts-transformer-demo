import {readFileSync, writeFileSync} from "fs";
import * as ts from "typescript";
import { VariableDeclaration } from "typescript";

function ensureBig(node: ts.Expression): ts.Expression {
    if (ts.SyntaxKind.NumericLiteral === node.kind) return node;
    if (ts.isBinaryExpression(node)) return rewriteBinaryExpression(node);
    throw new Error('Don\'t know what to do with this node: ' + node);
}

function rewriteBinaryExpression(node: ts.BinaryExpression): ts.Expression|undefined {
    let operator = node.operatorToken;
    let bigOperator;

    switch (operator.kind) {
        case ts.SyntaxKind.SlashToken:
            bigOperator = 'div'; break;
        case ts.SyntaxKind.AsteriskToken:
            bigOperator = 'times'; break;
        case ts.SyntaxKind.PlusToken:
            bigOperator = 'plus'; break;
        case ts.SyntaxKind.MinusToken:
            bigOperator = 'minus'; break;
        default:
            return;
    }
    
    let left = ensureBig(node.left);
    let right = ensureBig(node.right);

    return ts.createCall(
        ts.createPropertyAccess(
            ts.createNew(
                ts.createIdentifier('Big'),
                null,
                [left]
            ),
            ts.createIdentifier(bigOperator)
        ),
        null,
        [right]
    );
}

export function bigify(sourceFile: ts.SourceFile) {
    function bigifyChild(node: ts.Node) {
        if (node.parent) switch(node.kind) {
            case ts.SyntaxKind.BinaryExpression:
                let expression = rewriteBinaryExpression(node as ts.BinaryExpression);
                if (expression) switch (node.parent.kind) {
                    case ts.SyntaxKind.ExpressionStatement:
                        break;
                    case ts.SyntaxKind.VariableDeclaration:
                        (node.parent as ts.VariableDeclaration).initializer = expression;
                        break;
                }
        }

        ts.forEachChild(node, bigifyChild);
    }

    bigifyChild(sourceFile);
}

const fileNames = process.argv.slice(2);
fileNames.forEach(fileName => {
    let sourceFileText = readFileSync(fileName).toString();
    let sourceFile = ts.createSourceFile(fileName.split('.ts')[0], sourceFileText, ts.ScriptTarget.ES2015, true, ts.ScriptKind.TS);

    bigify(sourceFile);

    const printer = ts.createPrinter();
    const result = printer.printFile(sourceFile);
    
    try {
        //var output = transpileModule(input, { compilerOptions: compilerOptions, fileName: fileName, reportDiagnostics: !!diagnostics, moduleName: moduleName });
        //js = ts.transpile(result, {strict: true});

        //let js = ts.transpileModule(result, {compilerOptions: {strict: true}});
        //console.log(js.diagnostics);
        //writeFileSync(sourceFile.fileName + '.js', js.outputText);
        compile([fileName], {strict: true, noImplicitAny: false});

    } catch (e) {
        console.log('Transpiler broke.');
        console.log(e);
    }
});





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




function compile(fileNames: string[], options: ts.CompilerOptions): void {
    let program = ts.createProgram(fileNames, options);
    let emitResult = program.emit();

    let allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

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
    console.log(`Process exiting with code '${exitCode}'.`);
    process.exit(exitCode);
}

compile(process.argv.slice(2), {
    noEmitOnError: true, noImplicitAny: true,
    target: ts.ScriptTarget.ES5, module: ts.ModuleKind.CommonJS
});