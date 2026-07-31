/**
 * R2の代わりに、同じ約束(GETで取得・404なら未作成・PUTで保存)を守る置き場。
 *
 * 同期設定を入れたままプレビューすると、ダッシュボードは開いた直後に同期を試みる。
 * ダミーの認証情報で本物のR2を叩いても失敗するだけなので、ここで受け止めて
 * 「同期できている状態」の見た目を確かめられるようにする。
 */

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;

export function createFakeR2Fetch(): typeof fetch {
  const objects = new Map<string, string>();

  return (input, init) => {
    const url = String(input);
    if (init?.method === "PUT") {
      objects.set(url, String(init.body ?? ""));
      return Promise.resolve(new Response("", { status: HTTP_CREATED }));
    }
    const stored = objects.get(url);
    if (stored === undefined) {
      return Promise.resolve(new Response("", { status: HTTP_NOT_FOUND }));
    }
    return Promise.resolve(new Response(stored, { status: HTTP_OK }));
  };
}
