-- Cap lot_size to prevent unbounded sample plans / memory pressure
ALTER TABLE data_sheets
  ADD CONSTRAINT data_sheets_lot_size_max CHECK (lot_size <= 10000);
