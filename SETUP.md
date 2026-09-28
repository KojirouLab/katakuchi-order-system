# セットアップ手順(初めての方向け)

このアプリを実際に使えるようにするには、あと2つだけ準備が必要です。
「Supabase(データの保存先)」と「GitHub Pages(アプリの公開場所)」です。
どちらも無料で作れます。

## 1. Supabaseプロジェクトを作る

1. https://supabase.com にアクセスし、GitHubアカウントなどでサインアップ
2. 「New project」から新規プロジェクトを作成(名前は任意、リージョンは Tokyo (ap-northeast-1) がおすすめ)
3. 作成が終わったら、左メニューの **SQL Editor** を開き、このフォルダの `supabase.sql` の中身を貼り付けて実行(テーブルとアクセス制御ができます)
4. 左メニューの **Project Settings > API** を開き、次の2つをメモ
   - Project URL(例: `https://xxxxx.supabase.co`)
   - anon public key(長い文字列)
5. `storage.js` の一番上にある `SUPABASE_URL` と `SUPABASE_ANON_KEY` を、メモした値に書き換える

## 2. GitHubで公開する

1. GitHubで新しいリポジトリを作成(公開設定は任意ですが、店舗URLだけで守る運用なので Private 推奨)
2. この `order-system` フォルダの中身をそのリポジトリにpush
3. リポジトリの **Settings > Pages** で、公開元を「main ブランチ / ルート」に設定
4. 数分待つと `https://ユーザー名.github.io/リポジトリ名/` でアプリが開けるようになります

## 3. 各店舗にURLを配布する

公開したURL(例: `https://ユーザー名.github.io/リポジトリ名/`)をブラウザで開くと、
全店舗・全集計ページへのリンク一覧が出ます。ここから各店舗用のリンクをコピーして、
それぞれの店舗の発注担当者にLINEなどで配布してください。

- ピザ発注(各店舗が入力): 晩翠通り店 / ピザろっこ / 浅草店 / 牡蠣小屋ろっこ
- 牡蠣発注(各店舗が入力): 牡蠣小屋ろっこ / 牡蠣小屋もういっこ / 牡蠣小屋東一店 / 貝小屋はっこ
- ピザ受注集計(カタクチ商店が閲覧): `?shop=katakuchi`
- 牡蠣受注集計(牡蠣受注店が閲覧): `?shop=kaki-juchu`
- ピザ・牡蠣 全受注集計(配送受注店が閲覧): `?shop=haiso-juchu`

牡蠣小屋ろっこは、1つのURLの中に牡蠣とピザ2つの発注フォームが並んで表示されます。

店舗ごとのURLはブックマークやホーム画面追加(Safariの共有ボタン→「ホーム画面に追加」)
しておくと、次回から一発で開けます。

## 4. 運用上の注意

- ログイン機能はありません。**URLを知っている人は誰でも閲覧・入力できます。** 店舗以外に
  URLを共有しないでください。
- 発注の締切は、発注日の**前日の朝6:00**です。締切を過ぎた日付は入力欄がロックされ、
  内容の確認はできますが変更・キャンセルはできなくなります。
- 1つの店舗が同じ日付でもう一度送信すると、その日の内容は上書きされます(内容の修正・再送信として使えます)。
- 「これまでの発注」一覧をタップすると、その日の内容が発注フォームに読み込まれ、修正やキャンセル(削除)ができます。
- 店舗や集計先を増やしたい場合は、`app.js` の先頭にある `STORES` / `ADMIN_SHOPS` を編集してください。
  `STORES` の各店舗は `categories` に `pizza` / `oyster` を好きな数だけ指定でき、
  指定した分だけ発注フォームがその店舗のページに並びます。
- 締切時刻を変更したい場合は、`app.js` の `DEADLINE_HOUR`(現在は `6`)を書き換えてください。

## 5. 既存のSupabaseプロジェクトを更新する場合

機能追加のたびに、Supabase側で追加のSQL実行が必要になることがあります。
すでにSupabaseプロジェクトを作成済みの場合は、**SQL Editor** で以下を追加実行してください
(初めて作る場合は `supabase.sql` に全部含まれているので不要です)。

```sql
create policy "pizza anon delete" on pizza_orders for delete using (true);
create policy "oyster anon delete" on oyster_orders for delete using (true);
```

つぶ貝(whelk)機能は廃止しました。過去に追加した場合、`whelk_orders` テーブルは
アプリからは使われなくなります。不要であれば **SQL Editor** で
`drop table whelk_orders;` を実行して削除できます(元に戻せない操作なので、
削除前に必要なデータが残っていないか確認してください)。

## 6. 重要そうなメールをDiscordに通知する機能(任意)

会社共用の受信箱(shopify@catakuchi6.co.jp)を10分おきにチェックし、Claudeが「重要そうだ」
と判断したメールが来たら、Discordの個人DMに知らせる機能です。使わない場合は設定不要です。

### 6-1. Edge Functionをデプロイする

Supabase CLIで、このリポジトリの `supabase/functions/mail-alert-check` をデプロイしてください
(JWT検証なしで呼べるようにする `--no-verify-jwt` が必要です)。

```sh
supabase functions deploy mail-alert-check --no-verify-jwt --project-ref krdwyfemepbbyrteyoeb
```

### 6-2. Edge FunctionのSecretsを設定する

Supabaseダッシュボードの **Project Settings > Edge Functions > Secrets** で、以下を設定してください。

- `MAIL_IMAP_PASSWORD` … shopify@catakuchi6.co.jp のメールパスワード(IMAP用)
- `ANTHROPIC_API_KEY` … Claude APIキー([console.anthropic.com](https://console.anthropic.com/)で発行)
- `MAIL_ALERT_SECRET` … 下の6-3で確認する合言葉と同じ値
- `DISCORD_BOT_TOKEN` … kojiroulab-task-manager の通知機能(task-notify)で既に設定していれば
  追加不要です(同じSupabaseプロジェクトのSecretsは全Edge Functionで共有されます)。
  未設定の場合は、そちらのセットアップ手順に従ってDiscord Botを用意し、トークンを設定してください。

以下は必要な場合のみ上書きしてください(デフォルト値が入っています)。

- `MAIL_IMAP_HOST`(デフォルト: `sv958.xbiz.ne.jp`)
- `MAIL_IMAP_USER`(デフォルト: `shopify@catakuchi6.co.jp`)
- `MAIL_ALERT_DISCORD_USER_ID`(デフォルト: 通知先のDiscordユーザーID)

### 6-3. SQLを実行する

**SQL Editor** で `supabase/mail_alert.sql` の中身を実行してください。実行後、次のSQLで
自動生成された合言葉を確認し、6-2の `MAIL_ALERT_SECRET` に同じ値を設定してください。

```sql
select value from mail_alert_settings where key = 'secret';
```

設定が終われば、10分おきに自動でメールをチェックします。すぐに動作確認したい場合は、
SQL Editorで次を実行すると即座に1回チェックが走ります。

```sql
select trigger_mail_alert_check();
```

初回実行時は、それまでの既存メールには通知せず「最後に確認したメール」の基準だけを記録します
(いきなり大量の過去メールが通知されるのを防ぐためです)。2回目以降のチェックから、新着メールが
対象になります。

## 困ったときは

- 保存や読み込みに失敗する: 画面のエラーメッセージを確認し、通信状況を確認して再度お試しください。
  それでも直らない場合は `storage.js` の `SUPABASE_URL` / `SUPABASE_ANON_KEY` が正しいか確認してください。
