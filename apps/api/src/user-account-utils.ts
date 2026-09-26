export const MIN_USER_PASSWORD_LENGTH = 6;
export const MAX_USER_PASSWORD_LENGTH = 1024;
export const MIN_SHARED_PASSWORD_LENGTH = 15;
export const MAX_USERNAME_LENGTH = 128;

export function normalizeUsername(input: string): { username: string; usernameKey: string } {
  const username = input.trim();
  if (!username || username.length > MAX_USERNAME_LENGTH) {
    throw new Error("用户名必须为 1–" + MAX_USERNAME_LENGTH + " 个字符");
  }
  return { username, usernameKey: username.toLowerCase() };
}

export function validateSharedPassword(password: string | undefined): string {
  if (
    password === undefined ||
    password.trim().length === 0 ||
    password.length < MIN_SHARED_PASSWORD_LENGTH ||
    password.length > MAX_USER_PASSWORD_LENGTH
  ) {
    throw new Error(
      "AUTH_SHARED_DEFAULT_PASSWORD 必须是 " +
        MIN_SHARED_PASSWORD_LENGTH +
        "–" +
        MAX_USER_PASSWORD_LENGTH +
        " 个字符的随机密码",
    );
  }
  return password;
}
