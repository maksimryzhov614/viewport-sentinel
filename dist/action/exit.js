const value = process.argv[2];
switch (value) {
    case '0':
        process.exitCode = 0;
        break;
    case '1':
        process.exitCode = 1;
        break;
    case '2':
        process.exitCode = 2;
        break;
    default:
        process.exitCode = 2;
}
export {};
//# sourceMappingURL=exit.js.map