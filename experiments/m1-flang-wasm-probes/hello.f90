program hello
  implicit none
  print *, "Hello from Fortran on WebAssembly"
  print *, "kind(1.0) = ", kind(1.0)
  print *, "kind(1.0d0) = ", kind(1.0d0)
  print *, "sizeof int default = ", storage_size(1)/8
end program hello
