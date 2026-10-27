-- 车位互换 · 区域名变更的数据迁移脚本
--
-- 用法（在 stats/ 目录下执行）：
--   npx wrangler d1 execute yaohao-stats --remote --file=../scripts/migrate_swap_areas.sql
--
-- 说明：区域显示名同时是存储主键，改文案后必须跑一次迁移，
--       否则老数据的 layer 匹配不上新白名单，互相匹配会失效。

-- 1) 地上-H区 拆分为三个子区域
--    01510397 的车位在「靠近员工超市一侧」
UPDATE parking_swaps
   SET area = '地上-H区（靠近员工超市一侧）'
 WHERE emp = '01510397' AND area = '地上-H区';

--    21066696 的意向区域是「靠近创牌一侧」
UPDATE parking_swaps
   SET want1 = '地上-H区（靠近创牌一侧）'
 WHERE emp = '21066696' AND want1 = '地上-H区';

UPDATE parking_swaps
   SET want2 = '地上-H区（靠近创牌一侧）'
 WHERE emp = '21066696' AND want2 = '地上-H区';

-- 2) 区域拆分后重算「已匹配」标记（只重算有效登记，removed 的保留历史值）
UPDATE parking_swaps SET matched = 0 WHERE status = 'active';

UPDATE parking_swaps SET matched = 1
 WHERE status = 'active'
   AND id IN (
     SELECT p.id
       FROM parking_swaps p
       JOIN parking_swaps q
         ON q.status = 'active' AND q.id <> p.id AND q.layer = p.layer
        AND (q.want1 = p.area OR q.want2 = p.area)
        AND (p.want1 = q.area OR p.want2 = q.area)
   );
