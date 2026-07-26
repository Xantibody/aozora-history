/**
 * ビルド時刻。esbuild の --define で埋め込む。
 *
 * 拡張を入れ替えたつもりでタブに古いコードが残っていると、直したはずの挙動が
 * 直らず原因の切り分けが的外れになる。取り込みの結果にこれを載せておけば、
 * その結果がどのビルドのものかを設定画面で確かめられる
 */
declare const BUILD_STAMP: string | undefined;

// テストや未定義の環境では埋め込まれない
export const buildStamp: string = typeof BUILD_STAMP === "string" ? BUILD_STAMP : "dev";
