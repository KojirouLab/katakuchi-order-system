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
- つぶ貝発注(各店舗が入力): 牡蠣小屋東一店
- ピザ受注集計(カタクチ商店が閲覧): `?shop=katakuchi`
- 牡蠣・つぶ貝受注集計(牡蠣受注店が閲覧): `?shop=kaki-juchu`
- ピザ・牡蠣・つぶ貝 全受注集計(配送受注店が閲覧): `?shop=haiso-juchu`

牡蠣小屋ろっこと牡蠣小屋東一店は、1つのURLの中に複数の発注フォーム(牡蠣+ピザ、
牡蠣+つぶ貝)が並んで表示されます。

店舗ごとのURLはブックマークやホーム画面追加(Safariの共有ボタン→「ホーム画面に追加」)
しておくと、次回から一発で開けます。

## 4. 運用上の注意

- ログイン機能はありません。**URLを知っている人は誰でも閲覧・入力できます。** 店舗以外に
  URLを共有しないでください。
- 1つの店舗が同じ日付でもう一度送信すると、その日の内容は上書きされます(内容の修正・再送信として使えます)。
- 「これまでの発注」一覧をタップすると、その日の内容が発注フォームに読み込まれ、修正やキャンセル(削除)ができます。
- 店舗や集計先を増やしたい場合は、`app.js` の先頭にある `STORES` / `ADMIN_SHOPS` を編集してください。
  `STORES` の各店舗は `categories` に `pizza` / `oyster` / `whelk` を好きな数だけ指定でき、
  指定した分だけ発注フォームがその店舗のページに並びます。

## 5. 既存のSupabaseプロジェクトを更新する場合

機能追加のたびに、Supabase側で追加のSQL実行が必要になることがあります。
すでにSupabaseプロジェクトを作成済みの場合は、**SQL Editor** で以下を追加実行してください
(初めて作る場合は `supabase.sql` に全部含まれているので不要です)。

```sql
create policy "pizza anon delete" on pizza_orders for delete using (true);
create policy "oyster anon delete" on oyster_orders for delete using (true);

create table if not exists whelk_orders (
  id uuid primary key default gen_random_uuid(),
  store_slug text not null,
  store_name text not null,
  order_date date not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique (store_slug, order_date)
);

alter table whelk_orders enable row level security;

create policy "whelk anon select" on whelk_orders for select using (true);
create policy "whelk anon insert" on whelk_orders for insert with check (true);
create policy "whelk anon update" on whelk_orders for update using (true);
create policy "whelk anon delete" on whelk_orders for delete using (true);
```

## 困ったときは

- 保存や読み込みに失敗する: 画面のエラーメッセージを確認し、通信状況を確認して再度お試しください。
  それでも直らない場合は `storage.js` の `SUPABASE_URL` / `SUPABASE_ANON_KEY` が正しいか確認してください。
