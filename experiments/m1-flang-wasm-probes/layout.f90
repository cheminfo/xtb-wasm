program layout
  implicit none
  type :: t1
    character(len=:), allocatable :: name
  end type
  type :: t2
    real, allocatable :: v(:)
  end type
  type :: t3
    integer :: n
  end type
  type(t1) :: a
  type(t2) :: b
  type(t3) :: c
  print '(a,i0)', "storage_size(t1 char-alloc comp)/8 = ", storage_size(a)/8
  print '(a,i0)', "storage_size(t2 rank1-alloc comp)/8 = ", storage_size(b)/8
  print '(a,i0)', "storage_size(t3 plain int)/8 = ", storage_size(c)/8
end program
