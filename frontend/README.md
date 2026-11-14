# Angularフロントエンド

全体の起動方法と学習用の説明は [ルートのREADME](../README.md) を参照してください。Docker 上でソース保存を自動反映するときは、ルートの「コードを編集しながら開発する（画面の自動反映）」節（`./scripts/dev-web.sh`）を使います。

```sh
npm ci
npm start
```

Go APIとDocker MySQLの起動後、http://localhost:4200 で利用できます。ホストの `npm start` は `proxy.conf.json` 経由で API に接続します。
