import { stdin, stdout } from "node:process";
import { hashLoginPassword } from "./auth.js";

if (!stdin.isTTY) {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  await printHash(Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, ""));
} else {
  stdout.write("登录密码（输入不会回显）：");
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let password = "";
  for await (const chunk of stdin) {
    const value = String(chunk);
    if (value === "\u0003") process.exit(130);
    if (value === "\r" || value === "\n") break;
    if (value === "\u007f" || value === "\b") password = password.slice(0, -1);
    else password += value;
  }
  stdin.setRawMode(false);
  stdin.pause();
  stdout.write("\n");
  await printHash(password);
}

async function printHash(password: string): Promise<void> {
  stdout.write(`${await hashLoginPassword(password)}\n`);
}
