const crypto = require("node:crypto");
const readline = require("node:readline");

if (!process.stdin.isTTY) {
  console.error("Executa este comando num terminal interativo.");
  process.exit(1);
}
const input = readline.createInterface({ input: process.stdin, output: process.stdout });
process.stdout.write("Palavra-passe (não será mostrada): ");
input._writeToOutput = () => {};
input.question("", password => {
  input.close();
  console.log();
  if (password.length < 12) {
    console.error("Usa uma palavra-passe com pelo menos 12 caracteres.");
    process.exitCode = 1;
    return;
  }
  const salt = crypto.randomBytes(16);
  crypto.scrypt(password, salt, 64, (error, hash) => {
    if (error) { console.error("Não foi possível gerar a palavra-passe protegida.", error); process.exitCode = 1; return; }
    console.log(`scrypt:${salt.toString("hex")}:${hash.toString("hex")}`);
  });
});
