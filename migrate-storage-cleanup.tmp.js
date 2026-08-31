// 一時クリーンアップスクリプト（1回限り使用、実行後は削除してください）
//
// 履歴フォルダー移行の最終ステップ。新パス(archive/配下)への複製・DB移行が
// 完了した旧Storage実ファイル(元のパス)を削除する。
//
// 使い方:
//   cd /home/hr-dx/ai-projects/dx-sensor
//   SUPABASE_SERVICE_ROLE_KEY="<取得した値>" node migrate-storage-cleanup.tmp.js

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://zocexlnxkenpzopchovl.supabase.co";
const BUCKET = "auto-captures";

const OLD_PATHS = [
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/d7fe1073-905e-4c6d-9694-e267423c25d6.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/35aa4766-24f8-492f-9eb9-1e953a9f1a9b.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/f699c8c3-f76a-4b85-96e5-868e57786527.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/c0de3e3e-f2c3-4f88-ba42-43a4efa5ed43.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/16b0fd38-6981-401a-9717-9dee44ac8c3e.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/511b5530-00f0-4ca7-bd6d-aab2f2efebe1.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/cf30cc1b-ebb0-4544-a644-f172aa0bebbf.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/de637512-a443-4c5f-91d3-6411522d0479.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/59cc0379-9abe-4f8a-a79c-57ca1cdac2f3.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/5e098f32-1ad8-4ebd-83fe-e17d0f00ac36.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/18d26f7b-0bbb-4ce3-875a-78154610cfa8.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/b34b913d-7ce0-4908-8c60-3b01bbd79a25.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/446cd334-d725-4acf-b764-008ec19a3f39.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/08598cf6-d244-4175-a80a-55dad2cbe17d.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/2705fa25-9a7f-4f07-b630-f452bbe16f53.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/d75146e6-6710-45de-8f1e-8c0edc7b6f77.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/e4b85987-ddcb-46c4-8316-0f59b93506bb.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/406bb2be-2d64-44a5-a561-801dab352650.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/0b135370-3501-49e0-8efc-dd3ada0eead8.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/e3a912a0-4783-4d7d-b4fd-8ff80ca2036b.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/4f8b5b1c-6f5b-4c99-83ca-6f5593883d36.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/fccad170-1789-4833-8bc3-bccec4c32bdf.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/8d22ad15-d018-45f9-84e8-93f357798cb5.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/1cc27508-439e-4aaa-9732-6b9f90b087c5.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/763df4eb-5038-4f3b-b978-b9c92726abe6.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/a771f46b-3547-4442-8b02-7efdee9682c3.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/f608513e-645a-486b-bb19-47644e81554b.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/3cd3a590-f35b-4e87-b15a-a6bc5ed08d9a.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/5629b070-5e27-4adb-85db-fb1df7301b1c.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/7b609539-ca9f-40d5-92ab-4fc6e928f293.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/fbcc3755-0c0b-4249-8c72-4f5f36883e8f.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/1fa95f61-451d-4ae9-a10e-6050a9756d04.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/e09f964c-70b5-463c-a00f-4a355904ee68.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/6c8d7f88-dbec-447a-8954-fee320b9c4bf.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/66f8b7e2-1088-4458-9c31-5351235d7ff4.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/3754d887-be0d-4ab8-ba39-f14974c68ae3.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/9a37d158-d419-4459-acbb-708a48b2fadb.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/96899521-8c4a-4ecc-ae3a-11c7a32391c4.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/53b5f840-4e91-4c9e-a604-6bde9af4aea3.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/2bfc41a7-de66-4f68-b97b-7a66341fc882.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/59bf5cfb-78fa-4269-91bc-01593e072285.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/69a9c8cc-d30a-443b-847a-46f793b52ec1.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/341105e9-95a3-4be3-bf37-674519933eb1.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/881d3056-74c0-4494-829f-abd4f399d24c.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/4e896e7c-3bfe-4dfc-abbe-58b13c5f5f31.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/c0eb46a7-c49a-47e1-927b-2932233b191b.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/b47219d1-3086-41ea-9d97-75f763c2ccf7.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/45966581-5b25-4653-bcd6-1183816dea73.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/2500277c-9081-49f5-a97a-7092ae1ef005.jpg",
  "44369f90-3920-4923-b09c-88cc3304bde5/2026-08-31/e71148a8-039a-4170-8723-27751fd1c434.jpg",
];

async function main() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    console.error("環境変数 SUPABASE_SERVICE_ROLE_KEY を指定してください。");
    process.exit(1);
  }
  if (OLD_PATHS.length !== 50) {
    console.error(`想定件数と不一致です（期待50件、実際${OLD_PATHS.length}件）。中止します。`);
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Storage.remove は複数パスを一括で受け付ける。
  const { data, error } = await supabase.storage.from(BUCKET).remove(OLD_PATHS);
  if (error) {
    console.error("削除に失敗しました:", error.message);
    process.exit(1);
  }

  console.log(`削除成功: ${data.length}件`);
  if (data.length !== OLD_PATHS.length) {
    console.warn(
      `警告: 指定した${OLD_PATHS.length}件のうち${data.length}件しか削除結果が返っていません。` +
        "既に存在しなかったファイルが含まれていた可能性があります。"
    );
  }
}

main().catch((err) => {
  console.error("スクリプト実行中に予期しないエラー:", err);
  process.exit(1);
});
