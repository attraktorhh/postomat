-- Runs only on first start (empty data volume). The main database "postomat"
-- is created by the image from POSTGRES_DB.
CREATE DATABASE postomat_test OWNER postomat;
