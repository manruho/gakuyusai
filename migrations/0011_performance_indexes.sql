CREATE INDEX IF NOT EXISTS idx_sales_sale_type_created
  ON sales(sale_type, created_at);

CREATE INDEX IF NOT EXISTS idx_fulfillment_station_pickup_date_status_created
  ON fulfillment_orders(station_id, pickup_date, status, created_at);

CREATE INDEX IF NOT EXISTS idx_fulfillment_pickup_date_status_created
  ON fulfillment_orders(pickup_date, status, created_at);
