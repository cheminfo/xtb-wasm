program sizes
  use, intrinsic :: iso_c_binding
  implicit none
  type(c_ptr) :: p
  print '(a,i0)', "c_size_t   = ", c_size_t
  print '(a,i0)', "c_intptr_t = ", c_intptr_t
  print '(a,i0)', "c_long     = ", c_long
  print '(a,i0)', "c_int      = ", c_int
  print '(a,i0)', "storage_size(c_ptr)/8 = ", storage_size(p)/8
end program
