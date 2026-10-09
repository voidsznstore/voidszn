-- Starting catalog: the store's categories, plus four sample products so the
-- storefront has something to show until real products are added. Everything here
-- can be edited or deleted in the admin. Safe to run on a database that already
-- has any of it: existing rows are left alone.
INSERT INTO "categories" ("kind", "name", "slug", "description", "sort_order") VALUES
  ('PRODUCT_TYPE', 'T-Shirts', 't-shirts', 'Printed tees.', 0),
  ('PRODUCT_TYPE', 'Hoodies', 'hoodies', 'Pullover hoodies.', 1),
  ('PRODUCT_TYPE', 'Crewnecks', 'crewnecks', 'Crewneck sweatshirts.', 2),
  ('PRODUCT_TYPE', 'Hats', 'hats', 'Caps and hats.', 3),
  ('INTEREST', 'Anime', 'anime', 'Designs for anime fans.', 0),
  ('INTEREST', 'Gaming', 'gaming', 'Designs for people who play.', 1),
  ('INTEREST', 'Film & TV', 'film-and-tv', 'Designs for people who watch too much.', 2),
  ('INTEREST', 'Music', 'music', 'Designs for the loud ones.', 3),
  ('INTEREST', 'Halloween', 'halloween', 'Spooky season, all year.', 4),
  ('INTEREST', 'Everything Else', 'everything-else', 'Whatever doesn''t fit anywhere else.', 5)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "products" ("name", "slug", "short_description", "description", "details_text", "fit_text", "price_cents", "is_active", "sort_order", "created_at") VALUES
  ('Sample Tee 01', 'sample-tee-01', 'Sample product, here so you can see the layout.', 'This is a sample product. The real description goes in this spot: two or three sentences about the design, how the shirt fits, and what it is printed on.', 'Sample detail. Fabric and weight go here.
Sample detail. Print method goes here.
Sample detail. Care instructions go here.', 'Sample fit note. Say how it runs and what size the model is wearing.', 3200, true, 0, now() - interval '4 minutes'),
  ('Sample Tee 02', 'sample-tee-02', 'Sample product, here so you can see the layout.', 'This is a sample product. The real description goes in this spot: two or three sentences about the design, how the shirt fits, and what it is printed on.', 'Sample detail. Fabric and weight go here.
Sample detail. Print method goes here.
Sample detail. Care instructions go here.', 'Sample fit note. Say how it runs and what size the model is wearing.', 3200, true, 1, now() - interval '3 minutes'),
  ('Sample Tee 03', 'sample-tee-03', 'Sample product, here so you can see the layout.', 'This is a sample product. The real description goes in this spot: two or three sentences about the design, how the shirt fits, and what it is printed on.', 'Sample detail. Fabric and weight go here.
Sample detail. Print method goes here.
Sample detail. Care instructions go here.', 'Sample fit note. Say how it runs and what size the model is wearing.', 3400, true, 2, now() - interval '2 minutes'),
  ('Sample Tee 04', 'sample-tee-04', 'Sample product, here so you can see the layout.', 'This is a sample product. The real description goes in this spot: two or three sentences about the design, how the shirt fits, and what it is printed on.', 'Sample detail. Fabric and weight go here.
Sample detail. Print method goes here.
Sample detail. Care instructions go here.', 'Sample fit note. Say how it runs and what size the model is wearing.', 3400, true, 3, now() - interval '1 minutes')
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "product_categories" ("product_id", "category_id")
SELECT p."id", c."id"
FROM (VALUES
  ('sample-tee-01', 't-shirts'),
  ('sample-tee-01', 'gaming'),
  ('sample-tee-02', 't-shirts'),
  ('sample-tee-02', 'music'),
  ('sample-tee-03', 't-shirts'),
  ('sample-tee-03', 'film-and-tv'),
  ('sample-tee-03', 'halloween'),
  ('sample-tee-04', 't-shirts'),
  ('sample-tee-04', 'anime'),
  ('sample-tee-04', 'everything-else')
) AS link("product_slug", "category_slug")
JOIN "products" p ON p."slug" = link."product_slug"
JOIN "categories" c ON c."slug" = link."category_slug"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "product_colors" ("product_id", "name", "hex", "sort_order")
SELECT p."id", color."name", color."hex", color."sort_order"
FROM (VALUES
  ('sample-tee-01', 'Black', '#111111', 0),
  ('sample-tee-01', 'Bone', '#EDEAE3', 1),
  ('sample-tee-01', 'Olive', '#5E6B3F', 2),
  ('sample-tee-02', 'Bone', '#EDEAE3', 0),
  ('sample-tee-02', 'Black', '#111111', 1),
  ('sample-tee-03', 'Olive', '#5E6B3F', 0),
  ('sample-tee-03', 'Black', '#111111', 1),
  ('sample-tee-03', 'Bone', '#EDEAE3', 2),
  ('sample-tee-04', 'Black', '#111111', 0),
  ('sample-tee-04', 'Olive', '#5E6B3F', 1)
) AS color("product_slug", "name", "hex", "sort_order")
JOIN "products" p ON p."slug" = color."product_slug"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "product_variants" ("product_id", "color_id", "size", "sku", "price_cents", "sort_order")
SELECT p."id", c."id", variant."size", variant."sku", variant."price_cents", variant."sort_order"
FROM (VALUES
  ('sample-tee-01', 'Black', 'S', 'SAMPLE-TEE-01-BLACK-S', 3200, 0),
  ('sample-tee-01', 'Black', 'M', 'SAMPLE-TEE-01-BLACK-M', 3200, 1),
  ('sample-tee-01', 'Black', 'L', 'SAMPLE-TEE-01-BLACK-L', 3200, 2),
  ('sample-tee-01', 'Black', 'XL', 'SAMPLE-TEE-01-BLACK-XL', 3200, 3),
  ('sample-tee-01', 'Black', '2XL', 'SAMPLE-TEE-01-BLACK-2XL', 3200, 4),
  ('sample-tee-01', 'Bone', 'S', 'SAMPLE-TEE-01-BONE-S', 3200, 0),
  ('sample-tee-01', 'Bone', 'M', 'SAMPLE-TEE-01-BONE-M', 3200, 1),
  ('sample-tee-01', 'Bone', 'L', 'SAMPLE-TEE-01-BONE-L', 3200, 2),
  ('sample-tee-01', 'Bone', 'XL', 'SAMPLE-TEE-01-BONE-XL', 3200, 3),
  ('sample-tee-01', 'Bone', '2XL', 'SAMPLE-TEE-01-BONE-2XL', 3200, 4),
  ('sample-tee-01', 'Olive', 'S', 'SAMPLE-TEE-01-OLIVE-S', 3200, 0),
  ('sample-tee-01', 'Olive', 'M', 'SAMPLE-TEE-01-OLIVE-M', 3200, 1),
  ('sample-tee-01', 'Olive', 'L', 'SAMPLE-TEE-01-OLIVE-L', 3200, 2),
  ('sample-tee-01', 'Olive', 'XL', 'SAMPLE-TEE-01-OLIVE-XL', 3200, 3),
  ('sample-tee-01', 'Olive', '2XL', 'SAMPLE-TEE-01-OLIVE-2XL', 3200, 4),
  ('sample-tee-02', 'Bone', 'S', 'SAMPLE-TEE-02-BONE-S', 3200, 0),
  ('sample-tee-02', 'Bone', 'M', 'SAMPLE-TEE-02-BONE-M', 3200, 1),
  ('sample-tee-02', 'Bone', 'L', 'SAMPLE-TEE-02-BONE-L', 3200, 2),
  ('sample-tee-02', 'Bone', 'XL', 'SAMPLE-TEE-02-BONE-XL', 3200, 3),
  ('sample-tee-02', 'Bone', '2XL', 'SAMPLE-TEE-02-BONE-2XL', 3200, 4),
  ('sample-tee-02', 'Black', 'S', 'SAMPLE-TEE-02-BLACK-S', 3200, 0),
  ('sample-tee-02', 'Black', 'M', 'SAMPLE-TEE-02-BLACK-M', 3200, 1),
  ('sample-tee-02', 'Black', 'L', 'SAMPLE-TEE-02-BLACK-L', 3200, 2),
  ('sample-tee-02', 'Black', 'XL', 'SAMPLE-TEE-02-BLACK-XL', 3200, 3),
  ('sample-tee-02', 'Black', '2XL', 'SAMPLE-TEE-02-BLACK-2XL', 3200, 4),
  ('sample-tee-03', 'Olive', 'S', 'SAMPLE-TEE-03-OLIVE-S', 3400, 0),
  ('sample-tee-03', 'Olive', 'M', 'SAMPLE-TEE-03-OLIVE-M', 3400, 1),
  ('sample-tee-03', 'Olive', 'L', 'SAMPLE-TEE-03-OLIVE-L', 3400, 2),
  ('sample-tee-03', 'Olive', 'XL', 'SAMPLE-TEE-03-OLIVE-XL', 3400, 3),
  ('sample-tee-03', 'Olive', '2XL', 'SAMPLE-TEE-03-OLIVE-2XL', 3400, 4),
  ('sample-tee-03', 'Black', 'S', 'SAMPLE-TEE-03-BLACK-S', 3400, 0),
  ('sample-tee-03', 'Black', 'M', 'SAMPLE-TEE-03-BLACK-M', 3400, 1),
  ('sample-tee-03', 'Black', 'L', 'SAMPLE-TEE-03-BLACK-L', 3400, 2),
  ('sample-tee-03', 'Black', 'XL', 'SAMPLE-TEE-03-BLACK-XL', 3400, 3),
  ('sample-tee-03', 'Black', '2XL', 'SAMPLE-TEE-03-BLACK-2XL', 3400, 4),
  ('sample-tee-03', 'Bone', 'S', 'SAMPLE-TEE-03-BONE-S', 3400, 0),
  ('sample-tee-03', 'Bone', 'M', 'SAMPLE-TEE-03-BONE-M', 3400, 1),
  ('sample-tee-03', 'Bone', 'L', 'SAMPLE-TEE-03-BONE-L', 3400, 2),
  ('sample-tee-03', 'Bone', 'XL', 'SAMPLE-TEE-03-BONE-XL', 3400, 3),
  ('sample-tee-03', 'Bone', '2XL', 'SAMPLE-TEE-03-BONE-2XL', 3400, 4),
  ('sample-tee-04', 'Black', 'S', 'SAMPLE-TEE-04-BLACK-S', 3400, 0),
  ('sample-tee-04', 'Black', 'M', 'SAMPLE-TEE-04-BLACK-M', 3400, 1),
  ('sample-tee-04', 'Black', 'L', 'SAMPLE-TEE-04-BLACK-L', 3400, 2),
  ('sample-tee-04', 'Black', 'XL', 'SAMPLE-TEE-04-BLACK-XL', 3400, 3),
  ('sample-tee-04', 'Black', '2XL', 'SAMPLE-TEE-04-BLACK-2XL', 3400, 4),
  ('sample-tee-04', 'Olive', 'S', 'SAMPLE-TEE-04-OLIVE-S', 3400, 0),
  ('sample-tee-04', 'Olive', 'M', 'SAMPLE-TEE-04-OLIVE-M', 3400, 1),
  ('sample-tee-04', 'Olive', 'L', 'SAMPLE-TEE-04-OLIVE-L', 3400, 2),
  ('sample-tee-04', 'Olive', 'XL', 'SAMPLE-TEE-04-OLIVE-XL', 3400, 3),
  ('sample-tee-04', 'Olive', '2XL', 'SAMPLE-TEE-04-OLIVE-2XL', 3400, 4)
) AS variant("product_slug", "color_name", "size", "sku", "price_cents", "sort_order")
JOIN "products" p ON p."slug" = variant."product_slug"
JOIN "product_colors" c ON c."product_id" = p."id" AND c."name" = variant."color_name"
ON CONFLICT DO NOTHING;
